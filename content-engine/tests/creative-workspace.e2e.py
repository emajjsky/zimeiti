import json
import os
import tempfile
import re
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("CONTENT_ENGINE_E2E_URL", "http://127.0.0.1:5173")
ARTIFACTS = Path(tempfile.gettempdir()) / "content-engine-creative-workspace-e2e"
ARTIFACTS.mkdir(exist_ok=True)
PROJECT_ID = "project-research-1"
NOW = "2026-07-29T08:00:00.000Z"
SESSION = {
    "accessToken": "mock-access-token",
    "user": {"id": "user-1", "email": "creator@example.com", "display_name": "验收用户"},
    "workspace": {"id": "workspace-1", "name": "验收工作空间"},
}


def chrome_path():
    candidates = [
        os.getenv("PLAYWRIGHT_CHROME_PATH"),
        os.getenv("CHROME_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    return next((value for value in candidates if value and Path(value).exists()), None)


def respond(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))


def assert_no_overflow(page, label):
    dimensions = page.evaluate(
        """() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          bodyWidth: document.body.scrollWidth,
        })"""
    )
    assert dimensions["documentWidth"] <= dimensions["viewportWidth"], f"{label} 横向溢出: {dimensions}"
    assert dimensions["bodyWidth"] <= dimensions["viewportWidth"], f"{label} body 横向溢出: {dimensions}"


def project(stage="RESEARCH"):
    return {
        "id": PROJECT_ID,
        "title": "普通人如何核验 AI 工具的真实价值",
        "originType": "MANUAL",
        "stage": stage,
        "status": "RESEARCHING" if stage == "RESEARCH" else "WRITING",
        "planning": {
            "title": "普通人如何核验 AI 工具的真实价值",
            "category": "AI 工具",
            "angle": "从真实任务、使用成本和可验证结果出发",
            "objective": "帮助创作者建立可复用的工具评估方法",
            "targetAudience": "希望提高效率的普通创作者",
            "coreMessage": "先看真实任务与可验证结果，再判断工具价值",
            "targetPlatforms": ["WECHAT"],
            "timing": "EVERGREEN",
            "sourceRequirements": "优先使用官方资料",
            "constraints": "不夸大能力",
        },
        "planningVersion": 1,
        "coreViewpoint": "工具是否值得使用，要看它能否稳定解决真实问题。",
        "factChecks": ["核验当前价格与免费额度"],
        "versions": [{"id": "version-1", "platform": "WECHAT", "title": "", "body": "", "status": "DRAFT", "updatedAt": NOW}],
        "sourceSnapshot": {},
        "createdAt": NOW,
        "updatedAt": NOW,
    }


def research_result():
    return {
        "id": "research-result-1",
        "type": "RESEARCH_RESULT",
        "status": "CANDIDATE",
        "platform": None,
        "version": 1,
        "parentArtifactId": None,
        "createdAt": NOW,
        "acceptedAt": None,
        "payload": {
            "summary": "官方资料与用户素材可以支撑正文的核心判断，价格类信息仍应以发布前页面为准。",
            "facts": [{"claim": "产品定价和免费额度需要以官方价格页实时信息为准。"}],
            "cautions": [{"claim": "用户个案不能直接推导为所有人的使用结论。"}],
            "angles": ["用一项真实任务作为开场，再给出可复用的核验方法。"],
            "sources": [{"id": "source-1", "source": "官方文档", "title": "产品使用说明", "url": "https://example.com/docs"}],
            "materialContext": {"inputs": 1, "references": 1},
            "process": {"phase": "COMPLETED", "progress": 100},
        },
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        **({"executable_path": chrome_path()} if chrome_path() else {}),
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    state = {"project": project(), "phase": "idle", "agent_reads": 0, "requests": [], "unexpected": [], "console_errors": [], "brief_writes": 0}
    page.on("console", lambda message: state["console_errors"].append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: state["console_errors"].append(str(error)))
    page.add_init_script(
        "window.localStorage.setItem('content-engine-web-session-v1', " + json.dumps(json.dumps(SESSION, ensure_ascii=False)) + ");"
    )

    def agent_context():
        state["agent_reads"] += 1
        if state["phase"] == "running" and state["agent_reads"] >= 3:
            state["phase"] = "result"
        active_run = None
        artifacts = []
        if state["phase"] == "running":
            active_run = {
                "id": "research-run-1",
                "status": "RUNNING",
                "confirmation": {"phase": "VERIFYING", "progress": 60},
            }
        if state["phase"] == "result":
            artifacts = [research_result()]
        return {
            "stage": "RESEARCH",
            "platform": None,
            "messages": [],
            "summaries": [],
            "activeRun": active_run,
            "artifacts": artifacts,
            "usedMaterialIds": {"inputIds": [], "referenceIds": []},
        }

    def handle_api(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        method = request.method
        state["requests"].append(f"{method} {path}")

        if path == "/api/v1/auth/me" and method == "GET":
            return respond(route, {"user": SESSION["user"], "workspace": SESSION["workspace"]})
        if path == "/api/v1/workspace/state" and method == "GET":
            return respond(route, {"state": {"workspace": {"name": "验收工作空间", "enabledPlatforms": ["WECHAT"], "setupCompleted": True}, "sources": [], "intelligence": [], "topics": [], "projects": [state["project"]]}, "revision": 1, "updatedAt": NOW})
        if path == "/api/v1/workspace/state" and method == "PUT":
            return respond(route, {"revision": 2, "updatedAt": NOW})
        if path == "/api/v1/creative/projects" and method == "GET":
            return respond(route, {"projects": [state["project"]]})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/materials" and method == "GET":
            return respond(route, {
                "inputs": [{"id": "input-1", "kind": "IDEA", "title": "我的测试", "body": "我实际用过这个工具。", "scope": "PROJECT", "platforms": [], "createdAt": NOW, "updatedAt": NOW}],
                "references": [{"id": "reference-1", "sourceType": "LINK", "role": "FACT", "scope": "RESEARCH", "title": "官方说明", "url": "https://example.com/docs", "notes": "", "platforms": ["WECHAT"], "mimeType": None, "originalFilename": None, "sizeBytes": None, "createdAt": NOW, "updatedAt": NOW}],
            })
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/agent" and method == "GET":
            return respond(route, agent_context())
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/research/start" and method == "POST":
            payload = json.loads(request.post_data or "{}")
            assert payload == {"request": "核验价格信息，并保留我的实际测试感受"}
            state["phase"] = "running"
            state["agent_reads"] = 0
            return respond(route, {"id": "research-run-1", "status": "QUEUED", "confirmation": {"phase": "SOURCES"}}, status=202)
        if path == "/api/v1/creative/research-results/research-result-1/accept" and method == "POST":
            state["project"] = project("MASTER_WRITING")
            accepted = research_result()
            accepted["status"] = "ACCEPTED"
            accepted["acceptedAt"] = NOW
            return respond(route, {"artifact": accepted, "project": state["project"]})
        if path == "/api/v1/creative/skills" and method == "GET":
            return respond(route, [])
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "GET":
            return respond(route, {"brief": None})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "PUT":
            state["brief_writes"] += 1
            return respond(route, {"brief": json.loads(request.post_data or "{}")})
        if path == "/api/v1/intelligence/sources" and method == "GET":
            return respond(route, [])
        if path == "/api/v1/intelligence/items" and method == "GET":
            return respond(route, [])
        state["unexpected"].append(f"{method} {path}")
        return respond(route, {"error": {"message": f"未配置接口: {method} {path}"}}, status=418)

    page.route("**/api/v1/**", handle_api)
    page.goto(f"{BASE_URL}/?view=create&project={PROJECT_ID}&stage=research&platform=WECHAT")
    page.wait_for_load_state("networkidle")
    page.screenshot(path=ARTIFACTS / "simplified-research-initial.png", full_page=True)
    assert not state["console_errors"], {"errors": state["console_errors"], "requests": state["requests"], "unexpected": state["unexpected"]}

    page.get_by_role("heading", name="资料研究", exact=True).wait_for()
    page.get_by_role("button", name=re.compile(r"我的内容")).wait_for()
    page.get_by_role("button", name=re.compile(r"参考链接")).wait_for()
    page.get_by_role("button", name="开始研究", exact=True).wait_for()
    page.get_by_placeholder("不填则沿用当前项目上下文").fill("核验价格信息，并保留我的实际测试感受")
    page.get_by_role("button", name="开始研究", exact=True).click()
    page.locator(".simplified-research-running b").get_by_text("正在核验", exact=True).wait_for()
    page.get_by_text("可采用信息", exact=True).wait_for(timeout=10_000)
    page.get_by_text("产品定价和免费额度需要以官方价格页实时信息为准。", exact=True).wait_for()
    page.get_by_text("暂未确认", exact=True).wait_for()
    page.get_by_text("正文角度", exact=True).wait_for()
    assert_no_overflow(page, "1440px 研究结果")
    page.screenshot(path=ARTIFACTS / "simplified-research-desktop.png", full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "390px 研究结果")
    page.screenshot(path=ARTIFACTS / "simplified-research-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})

    page.get_by_role("button", name="采用并进入正文", exact=True).click()
    page.locator(".copy-editor").wait_for()
    page.get_by_text("已自动保存", exact=True).wait_for()
    assert state["brief_writes"] == 1
    assert "stage=master" in page.url
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
