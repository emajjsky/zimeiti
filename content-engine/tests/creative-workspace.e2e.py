from copy import deepcopy
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("CONTENT_ENGINE_E2E_URL", "http://127.0.0.1:5173")
ARTIFACTS = Path(tempfile.gettempdir()) / "content-engine-creative-workspace-e2e"
ARTIFACTS.mkdir(exist_ok=True)


def chrome_path():
    candidates = [
        os.getenv("PLAYWRIGHT_CHROME_PATH"),
        os.getenv("CHROME_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    return next((value for value in candidates if value and Path(value).exists()), None)


def json_response(route, body, status=200):
    route.fulfill(
        status=status,
        content_type="application/json",
        body=json.dumps(body, ensure_ascii=False),
    )


def empty_agent_context():
    return {
        "stage": "RESEARCH",
        "platform": None,
        "messages": [],
        "summaries": [],
        "activeRun": None,
        "artifacts": [],
        "usedMaterialIds": {"inputIds": [], "referenceIds": []},
    }


def project_from_input(project_id, payload, now, legacy_topic_id=None):
    title = payload.get("title", "").strip() or "未命名创作"
    platforms = payload.get("targetPlatforms") or ["WECHAT"]
    return {
        "id": project_id,
        "title": title,
        "originType": payload.get("originType", "MANUAL"),
        **({"legacyTopicId": legacy_topic_id} if legacy_topic_id else {}),
        "stage": "PLANNING",
        "status": "BRIEF",
        "planning": {
            "title": title,
            "category": payload.get("category", "").strip(),
            "angle": "",
            "objective": "",
            "targetAudience": "",
            "coreMessage": "",
            "targetPlatforms": platforms,
            "timing": "EVERGREEN",
            "sourceRequirements": "",
            "constraints": "",
        },
        "planningVersion": 0,
        "coreViewpoint": "",
        "factChecks": [],
        "versions": [],
        "sourceSnapshot": {
            "draftText": payload.get("draftText"),
            "importUrl": payload.get("importUrl"),
        },
        "createdAt": now,
        "updatedAt": now,
    }


def assert_no_overflow(page, label):
    dimensions = page.evaluate(
        """() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          bodyWidth: document.body.scrollWidth,
        })"""
    )
    assert dimensions["documentWidth"] <= dimensions["viewportWidth"], (
        f"{label} 横向溢出: {dimensions}"
    )
    assert dimensions["bodyWidth"] <= dimensions["viewportWidth"], (
        f"{label} body 横向溢出: {dimensions}"
    )


NOW = "2026-07-28T08:00:00.000Z"
HOTSPOT_ID = "intel-ai-1"
HOTSPOT_TITLE = "普通人使用 AI 搜索时，如何核验答案来源"
SESSION = {
    "accessToken": "mock-access-token",
    "user": {"id": "user-1", "email": "creator@example.com", "display_name": "创作者"},
    "workspace": {"id": "workspace-1", "name": "验收工作室"},
}
STATE = {
    "workspace": {
        "name": "验收工作室",
        "materialRoot": "",
        "primaryTopics": ["AI 工具", "财经"],
        "accountPositioning": "帮助普通人把复杂信息转化为可执行内容",
        "targetAudience": "普通内容创作者",
        "enabledPlatforms": ["WECHAT", "XIAOHONGSHU", "ZHIHU", "WEIBO"],
        "setupCompleted": True,
    },
    "feishuTemplate": {
        "name": "内容引擎内容库",
        "topicStorage": "ONE_TABLE",
        "includeSchedule": True,
        "includeReview": False,
        "status": "DRAFT",
    },
    "sources": [
        {
            "id": "source-1",
            "name": "中国新闻网",
            "type": "RSS",
            "url": "https://example.com/rss.xml",
            "category": "综合",
            "enabled": True,
            "refreshMinutes": 60,
            "trust": "可信",
        }
    ],
    "intelligence": [
        {
            "id": HOTSPOT_ID,
            "title": HOTSPOT_TITLE,
            "summary": "从出处、时间、交叉来源和原始材料四个维度核验 AI 搜索答案。",
            "category": "AI",
            "keywords": ["AI 搜索", "事实核验"],
            "source": "中国新闻网",
            "publishedAt": NOW,
            "heat": 88,
            "trust": "可信",
            "url": "https://example.com/ai-search-fact-check",
            "captureMethod": "RSS",
            "language": "zh",
        }
    ],
    "topics": [],
    "projects": [],
}


with sync_playwright() as playwright:
    executable = chrome_path()
    browser = playwright.chromium.launch(
        headless=True,
        **({"executable_path": executable} if executable else {}),
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    state = deepcopy(STATE)
    api_requests = []
    unexpected_api = []
    console_errors = []
    failed_responses = []

    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda response: failed_responses.append(
            f"{response.request.method} {response.status} {response.url}"
        )
        if response.status >= 400
        else None,
    )

    session_value = json.dumps(SESSION, ensure_ascii=False)
    page.add_init_script(
        f"window.localStorage.setItem('content-engine-web-session-v1', {json.dumps(session_value, ensure_ascii=False)});"
    )

    def find_project(project_id):
        return next((item for item in state["projects"] if item["id"] == project_id), None)

    def replace_project(project):
        state["projects"] = [
            project if item["id"] == project["id"] else item
            for item in state["projects"]
        ]

    def handle_api(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        method = request.method
        api_requests.append(f"{method} {path}")

        if path == "/api/v1/auth/me" and method == "GET":
            return json_response(route, {"user": SESSION["user"], "workspace": SESSION["workspace"]})
        if path == "/api/v1/workspace/state" and method == "GET":
            return json_response(route, {"state": state, "revision": 1, "updatedAt": NOW})
        if path == "/api/v1/workspace/state" and method == "PUT":
            payload = json.loads(request.post_data or "{}")
            state.clear()
            state.update(deepcopy(payload["state"]))
            return json_response(route, {"revision": 2, "updatedAt": NOW})
        if path == "/api/v1/intelligence/sources" and method == "GET":
            return json_response(route, state["sources"])
        if path == "/api/v1/intelligence/items" and method == "GET":
            return json_response(route, state["intelligence"])
        if re.fullmatch(r"/api/v1/intelligence/items/[^/]+/analyses/latest", path) and method == "GET":
            return json_response(route, None)
        if re.fullmatch(r"/api/v1/intelligence/items/[^/]+/analyses/latest-run", path) and method == "GET":
            return json_response(route, None)
        if path == "/api/v1/creative/skills" and method == "GET":
            return json_response(route, [])
        if path == "/api/v1/creative/projects" and method == "GET":
            return json_response(route, {"projects": state["projects"]})
        if path == "/api/v1/creative/projects" and method == "POST":
            payload = json.loads(request.post_data or "{}")
            project = project_from_input(
                "project-manual-1", payload, NOW, legacy_topic_id="legacy-topic-1"
            )
            state["projects"] = [project, *state["projects"]]
            return json_response(route, {"project": project, "created": True}, status=201)

        hotspot_match = re.fullmatch(
            r"/api/v1/creative/projects/from-intelligence/([^/]+)", path
        )
        if hotspot_match and method == "POST":
            item_id = hotspot_match.group(1)
            existing = next(
                (
                    item
                    for item in state["projects"]
                    if item.get("originType") == "HOTSPOT"
                    and item.get("originReferenceId") == item_id
                ),
                None,
            )
            if existing:
                return json_response(route, {"project": existing, "created": False})
            intelligence = next(item for item in state["intelligence"] if item["id"] == item_id)
            project = project_from_input(
                "project-hotspot-1",
                {
                    "originType": "HOTSPOT",
                    "title": intelligence["title"],
                    "category": intelligence["category"],
                    "targetPlatforms": ["WECHAT", "XIAOHONGSHU"],
                },
                NOW,
            )
            project["originReferenceId"] = item_id
            project["sourceSnapshot"] = {"intelligenceIds": [item_id]}
            state["projects"] = [project, *state["projects"]]
            return json_response(route, {"project": project, "created": True}, status=201)

        complete_match = re.fullmatch(
            r"/api/v1/creative/projects/([^/]+)/planning/complete", path
        )
        if complete_match and method == "POST":
            project = deepcopy(find_project(complete_match.group(1)))
            project["stage"] = "RESEARCH"
            project["planningVersion"] = 1
            project["planningConfirmedAt"] = NOW
            project["coreViewpoint"] = project["planning"]["coreMessage"]
            project["factChecks"] = [
                value.strip()
                for value in project["planning"]["sourceRequirements"].split("；")
                if value.strip()
            ]
            project["versions"] = [
                {
                    "id": f"version-{platform.lower()}",
                    "platform": platform,
                    "status": "DRAFT",
                    "title": project["title"],
                    "body": "",
                    "updatedAt": NOW,
                }
                for platform in project["planning"]["targetPlatforms"]
            ]
            project["updatedAt"] = NOW
            replace_project(project)
            return json_response(route, {"project": project})

        planning_match = re.fullmatch(
            r"/api/v1/creative/projects/([^/]+)/planning", path
        )
        if planning_match:
            project = find_project(planning_match.group(1))
            if method == "GET":
                return json_response(route, {"project": project, "planning": project["planning"]})
            if method == "PUT":
                planning = json.loads(request.post_data or "{}")
                project = deepcopy(project)
                project["planning"] = planning
                project["title"] = planning["title"]
                project["updatedAt"] = NOW
                replace_project(project)
                return json_response(route, {"project": project, "planning": planning})

        brief_match = re.fullmatch(r"/api/v1/creative/projects/([^/]+)/brief", path)
        if brief_match and method == "GET":
            return json_response(route, {"brief": None})
        materials_match = re.fullmatch(
            r"/api/v1/creative/projects/([^/]+)/materials", path
        )
        if materials_match and method == "GET":
            return json_response(route, {"inputs": [], "references": []})
        agent_match = re.fullmatch(r"/api/v1/creative/projects/([^/]+)/agent", path)
        if agent_match and method == "GET":
            return json_response(route, empty_agent_context())

        unexpected_api.append(f"{method} {path}")
        return json_response(
            route,
            {"error": {"message": f"E2E 未配置接口：{method} {path}"}},
            status=418,
        )

    page.route("**/api/v1/**", handle_api)

    # 1. 创作项目中心空状态与手工新建。
    page.goto(f"{BASE_URL}/?view=create")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="创作", exact=True).wait_for()
    page.get_by_text("还没有内容项目", exact=True).wait_for()
    page.set_viewport_size({"width": 1024, "height": 900})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "1024px 项目中心")
    page.set_viewport_size({"width": 1440, "height": 1000})

    page.get_by_role("button", name="新建第一篇内容", exact=True).click()
    page.get_by_label("项目标题").fill("普通人如何判断 AI 工具是否值得长期使用")
    page.get_by_label("题材").fill("AI 工具")
    page.get_by_role("button", name="创建项目", exact=True).click()
    page.get_by_role("heading", name="内容规划", exact=True).wait_for()
    assert "view=create" in page.url and "project=project-manual-1" in page.url
    assert "stage=planning" in page.url

    # 2. 保存规划，确认后进入研究；刷新仍恢复同一项目与阶段。
    page.get_by_label("创作角度").fill("从真实任务、使用成本和可验证结果三个维度判断")
    page.get_by_label("创作目标").fill("帮助普通创作者建立一套可重复使用的工具评估方法")
    page.get_by_label("目标受众").fill("想提高效率但不熟悉技术的普通内容创作者")
    page.get_by_label("核心表达").fill("工具是否值得使用，要看它能否稳定解决真实问题")
    page.get_by_label("来源与核验要求").fill("核验产品当前价格；核验免费额度")
    page.get_by_label("禁止表达与必须保留内容").fill("不夸大能力；保留真实测试结果")
    page.get_by_role("button", name="保存规划", exact=True).click()
    page.get_by_text(re.compile(r"已保存"), exact=False).wait_for()
    page.get_by_role("button", name="确认规划，开始研究", exact=True).click()
    page.get_by_role("heading", name="资料与研究", exact=True).wait_for()
    assert "stage=research" in page.url
    assert page.get_by_role("button", name="研究", exact=True).get_attribute("class") == "active"

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "390px 研究工作台")
    page.screenshot(path=ARTIFACTS / "research-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})

    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="资料与研究", exact=True).wait_for()
    page.get_by_role("heading", name="普通人如何判断 AI 工具是否值得长期使用", exact=True).wait_for()
    assert "project=project-manual-1" in page.url and "stage=research" in page.url

    # 3. 热点加入创作后，发现卡片显示“已加入”，并可继续进入原项目。
    page.get_by_role("button", name="发现", exact=True).click()
    page.get_by_role("heading", name="热点情报", exact=True).wait_for()
    hotspot_card = page.locator(".intelligence-card").filter(has_text=HOTSPOT_TITLE)
    hotspot_card.click()
    page.get_by_role("button", name="加入创作", exact=True).click()
    page.get_by_role("heading", name="内容规划", exact=True).wait_for()
    page.get_by_role("heading", name=HOTSPOT_TITLE, exact=True).wait_for()
    assert "project=project-hotspot-1" in page.url

    page.get_by_role("button", name="发现", exact=True).click()
    page.get_by_role("heading", name="热点情报", exact=True).wait_for()
    hotspot_card = page.locator(".intelligence-card").filter(has_text=HOTSPOT_TITLE)
    assert hotspot_card.get_by_text("已加入", exact=True).count() == 1
    hotspot_card.click()
    page.get_by_role("button", name="继续创作", exact=True).click()
    page.get_by_role("heading", name="内容规划", exact=True).wait_for()
    assert "project=project-hotspot-1" in page.url

    # 4. 创作首页使用项目列表与选中项目详情，移动端使用底部详情抽屉。
    page.get_by_role("button", name="创作", exact=True).click()
    page.locator(".creative-project-table").wait_for()
    project_rows = page.locator(".creative-project-table tbody tr")
    assert project_rows.count() == 2
    project_rows.filter(has_text=HOTSPOT_TITLE).click()
    page.locator(".creative-project-detail").get_by_role(
        "heading", name=HOTSPOT_TITLE, exact=True
    ).wait_for()
    assert page.locator(".creative-project-card").count() == 0
    page.screenshot(path=ARTIFACTS / "project-center-desktop.png", full_page=True)

    page.set_viewport_size({"width": 1024, "height": 900})
    page.wait_for_timeout(100)
    assert page.locator(".creative-project-table").is_visible()
    assert page.locator(".creative-project-detail").is_visible()
    assert_no_overflow(page, "1024px 创作项目中心")

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert not page.locator(".creative-project-table").is_visible()
    mobile_projects = page.locator(".creative-project-mobile-list")
    mobile_projects.wait_for()
    assert mobile_projects.locator(".creative-project-mobile-row").count() == 2
    mobile_projects.locator(".creative-project-mobile-row").filter(
        has_text=HOTSPOT_TITLE
    ).click()
    page.locator(".creative-project-mobile-drawer").get_by_role(
        "heading", name=HOTSPOT_TITLE, exact=True
    ).wait_for()
    assert_no_overflow(page, "390px 创作项目中心")
    page.screenshot(path=ARTIFACTS / "project-center-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})

    # 5. 旧规划 URL 通过 legacyTopicId 恢复到统一创作项目。
    page.goto(f"{BASE_URL}/?view=plan&topic=legacy-topic-1")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="内容规划", exact=True).wait_for()
    page.get_by_role("heading", name="普通人如何判断 AI 工具是否值得长期使用", exact=True).wait_for()
    assert "view=create" in page.url and "project=project-manual-1" in page.url
    assert "topic=" not in page.url and "stage=planning" in page.url

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "390px 旧规划 URL 恢复")

    # 所有业务请求都由本脚本 Mock；没有触发模型、搜索或刷新接口。
    forbidden_fragments = [
        "/analyses/prepare",
        "/generation-runs/",
        "/models/",
        "/settings/credentials/",
        "/intelligence/search",
        "/intelligence/rss/refresh",
        "/agent/prepare",
    ]
    assert not unexpected_api, unexpected_api
    assert not failed_responses, failed_responses
    assert not console_errors, console_errors
    assert not [
        request
        for request in api_requests
        if any(fragment in request for fragment in forbidden_fragments)
    ], api_requests
    assert any("POST /api/v1/creative/projects" == request for request in api_requests)
    assert any(
        request == f"POST /api/v1/creative/projects/from-intelligence/{HOTSPOT_ID}"
        for request in api_requests
    )
    assert any(request.endswith("/planning/complete") for request in api_requests)

    browser.close()
