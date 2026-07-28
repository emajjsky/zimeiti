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
    agent_contexts = {}
    prepared_agent_payloads = []
    prepared_source_payloads = []

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
            return json_response(
                route,
                agent_contexts.get(agent_match.group(1), empty_agent_context()),
            )

        agent_prepare_match = re.fullmatch(
            r"/api/v1/creative/projects/([^/]+)/agent/prepare", path
        )
        if agent_prepare_match and method == "POST":
            project_id = agent_prepare_match.group(1)
            payload = json.loads(request.post_data or "{}")
            prepared_agent_payloads.append(payload)
            run = {
                "id": "research-run-draft-1",
                "action": "PROJECT_RESEARCH_PLAN",
                "status": "DRAFT",
                "request": payload["request"],
                "confirmation": {
                    "model": "qwen3.7-max-2026-06-08",
                    "promptVersion": "1.0.0",
                    "skillNames": [],
                    "materialCount": len(payload.get("inputIds", []))
                    + len(payload.get("referenceIds", [])),
                    "writeScope": "RESEARCH",
                },
                "createdAt": NOW,
            }
            agent_contexts[project_id] = {
                **empty_agent_context(),
                "messages": [
                    {
                        "id": "research-user-message-1",
                        "role": "USER",
                        "content": payload["request"],
                        "runId": run["id"],
                        "stage": "RESEARCH",
                        "messageType": "MESSAGE",
                        "artifactRefs": [],
                        "metadata": {},
                        "createdAt": NOW,
                    },
                    {
                        "id": "research-confirmation-message-1",
                        "role": "ASSISTANT",
                        "content": "研究计划已准备，确认后开始执行。",
                        "runId": run["id"],
                        "stage": "RESEARCH",
                        "messageType": "CONFIRMATION",
                        "artifactRefs": [],
                        "metadata": {},
                        "createdAt": NOW,
                    },
                ],
                "activeRun": run,
            }
            return json_response(route, run, status=201)

        source_prepare_match = re.fullmatch(
            r"/api/v1/creative/projects/([^/]+)/research/sources/prepare", path
        )
        if source_prepare_match and method == "POST":
            project_id = source_prepare_match.group(1)
            payload = json.loads(request.post_data or "{}")
            prepared_source_payloads.append(payload)
            current = agent_contexts[project_id]
            run = {
                "id": "research-source-run-1",
                "action": "PROJECT_RESEARCH_SOURCES",
                "status": "DRAFT",
                "request": "查找研究资料",
                "confirmation": {
                    "model": "",
                    "promptVersion": "1.0.0",
                    "skillNames": [],
                    "materialCount": 0,
                    "writeScope": "项目研究来源",
                    "sourceCounts": {
                        "search": 1,
                        "read": 1,
                        "askUser": 1,
                        "automatic": 2,
                    },
                    "tools": ["Tavily 网页搜索", "公开网页读取", "用户补充"],
                },
                "createdAt": NOW,
            }
            agent_contexts[project_id] = {**current, "activeRun": run}
            return json_response(route, run, status=201)

        source_confirm_match = re.fullmatch(
            r"/api/v1/creative/research-source-runs/([^/]+)/confirm", path
        )
        if source_confirm_match and method == "POST":
            project_id = "project-manual-1"
            current = agent_contexts[project_id]
            source_artifact = {
                "id": "research-sources-artifact-1",
                "type": "RESEARCH_SOURCES",
                "status": "CANDIDATE",
                "platform": None,
                "version": 1,
                "parentArtifactId": None,
                "payload": {
                    "title": "研究来源",
                    "summary": "已保存 1 条来源，1 项需要补充，0 项失败。",
                    "notice": "来源已保存，尚未完成事实核验。",
                    "verified": False,
                    "counts": {"captured": 1, "needsUser": 1, "failed": 0},
                    "sources": [
                        {
                            "id": "source-result-1",
                            "actionIndex": 0,
                            "action": "SEARCH_WEB",
                            "purpose": "查找官方说明",
                            "target": "AI 工具 官方说明",
                            "status": "CAPTURED",
                            "title": "AI 工具官方说明",
                            "url": "https://example.com/official",
                            "source": "example.com",
                            "summary": "官方说明摘要",
                            "error": None,
                            "retrievedAt": NOW,
                        },
                        {
                            "id": "source-result-2",
                            "actionIndex": 2,
                            "action": "ASK_USER",
                            "purpose": "补充实测截图",
                            "target": "上传自己的测试截图",
                            "status": "NEEDS_USER",
                            "title": "补充实测截图",
                            "url": None,
                            "source": "用户补充",
                            "summary": "上传自己的测试截图",
                            "error": None,
                            "retrievedAt": NOW,
                        },
                    ],
                },
                "createdAt": NOW,
                "acceptedAt": None,
            }
            source_message = {
                "id": "research-source-message-1",
                "role": "ASSISTANT",
                "content": "已保存 1 条来源，1 项需要补充，0 项失败。",
                "runId": "research-source-run-1",
                "stage": "RESEARCH",
                "messageType": "ARTIFACT",
                "artifactRefs": [source_artifact["id"]],
                "metadata": {"verified": False},
                "createdAt": NOW,
            }
            agent_contexts[project_id] = {
                **current,
                "activeRun": None,
                "messages": [*current["messages"], source_message],
                "artifacts": [source_artifact, *current["artifacts"]],
            }
            return json_response(
                route,
                {"id": "research-source-run-1", "status": "QUEUED", "jobId": "job-source-1"},
                status=202,
            )

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

    # 2.1 零资料时可用唯一快捷动作准备研究计划，确认前不调用模型。
    page.get_by_text("未选资料", exact=True).wait_for()
    page.get_by_role("button", name="制定研究计划", exact=True).click()
    confirmation = page.locator(".agent-confirmation")
    confirmation.get_by_text("生成研究计划", exact=True).wait_for()
    assert confirmation.get_by_text("0 条", exact=True).count() == 1
    assert page.locator(".project-agent-message.type-confirmation").count() == 0
    assert prepared_agent_payloads[-1]["stage"] == "RESEARCH"
    assert prepared_agent_payloads[-1]["inputIds"] == []
    assert prepared_agent_payloads[-1]["referenceIds"] == []

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

    # 2.2 研究计划可准备来源任务，确认卡不伪装成模型调用；来源结果刷新后仍存在。
    research_plan_artifact = {
        "id": "research-plan-artifact-1",
        "type": "RESEARCH_PLAN",
        "status": "CANDIDATE",
        "platform": None,
        "version": 1,
        "parentArtifactId": None,
        "payload": {
            "title": "AI 工具研究计划",
            "summary": "先查官方说明，再核对用户实测。",
            "questions": [
                {
                    "question": "当前支持哪些能力？",
                    "why": "避免使用过期信息",
                    "preferredSources": ["官方说明"],
                }
            ],
            "claims": [
                {"claim": "免费版可长期使用", "priority": "HIGH", "reason": "影响结论"}
            ],
            "nextActions": [
                {"action": "SEARCH_WEB", "purpose": "查找官方说明", "target": "AI 工具 官方说明"},
                {"action": "READ_LINK", "purpose": "读取产品文档", "target": "https://example.com/docs"},
                {"action": "ASK_USER", "purpose": "补充实测截图", "target": "上传自己的测试截图"},
            ],
        },
        "createdAt": NOW,
        "acceptedAt": None,
    }
    agent_contexts["project-manual-1"] = {
        **empty_agent_context(),
        "messages": [
            {
                "id": "research-plan-message-1",
                "role": "ASSISTANT",
                "content": "先查官方说明，再核对用户实测。",
                "runId": "research-plan-run-1",
                "stage": "RESEARCH",
                "messageType": "ARTIFACT",
                "artifactRefs": [research_plan_artifact["id"]],
                "metadata": {},
                "createdAt": NOW,
            }
        ],
        "artifacts": [research_plan_artifact],
    }
    page.reload()
    page.get_by_role("button", name="查看计划", exact=True).click()
    plan_dialog = page.get_by_role("dialog")
    plan_dialog.get_by_role("button", name="准备查找资料", exact=True).click()
    source_confirmation = page.locator(".agent-confirmation")
    source_confirmation.get_by_text("查找研究来源", exact=True).wait_for()
    assert source_confirmation.get_by_text("搜索 1 次", exact=True).count() == 1
    assert source_confirmation.get_by_text("读取 1 个", exact=True).count() == 1
    assert source_confirmation.get_by_text("补充 1 项", exact=True).count() == 1
    assert source_confirmation.get_by_text("模型", exact=True).count() == 0
    assert prepared_source_payloads[-1]["planArtifactId"] == research_plan_artifact["id"]
    source_confirmation.get_by_role("button", name="确认执行", exact=True).click()
    page.get_by_text("来源结果", exact=True).wait_for()
    page.get_by_role("button", name="查看来源", exact=True).click()
    source_dialog = page.get_by_role("dialog")
    source_dialog.get_by_text("来源已保存，尚未完成事实核验。", exact=True).wait_for()
    source_dialog.get_by_text("AI 工具官方说明", exact=True).wait_for()
    source_dialog.get_by_text("补充实测截图", exact=True).wait_for()
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "390px 研究来源结果")
    page.screenshot(path=ARTIFACTS / "research-sources-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})
    source_dialog.get_by_role("button", name="关闭", exact=True).click()
    page.reload()
    page.get_by_role("button", name="查看来源", exact=True).wait_for()

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
        "/agent-runs/",
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
    assert any(request.endswith("/agent/prepare") for request in api_requests)

    browser.close()
