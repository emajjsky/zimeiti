import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("CONTENT_ENGINE_E2E_URL", "http://127.0.0.1:5173")
ARTIFACTS = Path(tempfile.gettempdir()) / "content-engine-creative-workspace-e2e"
ARTIFACTS.mkdir(exist_ok=True)
PROJECT_ID = "project-linear-1"
DRAFT_ID = "11111111-1111-4111-8111-111111111111"
TEMPLATE_ID = "22222222-2222-4222-8222-222222222222"
TEMPLATE_VERSION_ID = "33333333-3333-4333-8333-333333333333"
NOW = "2026-08-02T08:00:00.000Z"
SESSION = {
    "accessToken": "mock-access-token",
    "user": {"id": "user-1", "email": "creator@example.com", "display_name": "验收用户"},
    "workspaces": [{"id": "workspace-1", "name": "内容工作室", "role": "OWNER", "status": "ACTIVE"}],
    "activeWorkspaceId": "workspace-1",
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


def project(stage):
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
            "coreMessage": "先看真实任务和可验证结果，再判断工具价值",
            "targetPlatforms": ["WECHAT"],
            "timing": "EVERGREEN",
            "sourceRequirements": "优先使用官方资料",
            "constraints": "不夸大能力",
        },
        "planningVersion": 1,
        "planningConfirmedAt": NOW,
        "coreViewpoint": "工具是否值得使用，要看它能否稳定解决真实问题。",
        "factChecks": [],
        "versions": [{"id": "legacy-wechat-version", "platform": "WECHAT", "title": "", "body": "", "status": "DRAFT", "updatedAt": NOW}],
        "delivery": {"platforms": {}},
        "sourceSnapshot": {},
        "createdAt": NOW,
        "updatedAt": NOW,
    }


def layout_rules():
    return {
        "schemaVersion": 1,
        "canvas": {"background": "#ffffff", "textColor": "#17203b", "maxWidth": 677},
        "title": {"fontSize": 30, "fontWeight": 700, "lineHeight": 1.35, "color": "#17203b"},
        "body": {"fontSize": 16, "lineHeight": 1.9, "paragraphSpacing": 18},
        "heading": {"fontSize": 21, "color": "#1e5bff", "borderColor": "#1e5bff"},
        "quote": {"background": "#f5f7fa", "borderColor": "#94a3b8"},
        "image": {"borderRadius": 0, "spacing": 20, "captionColor": "#64748b"},
        "divider": {"color": "#d1d5db", "thickness": 1},
    }


def assert_no_overflow(page, label):
    dimensions = page.evaluate("""() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
    })""")
    assert dimensions["documentWidth"] <= dimensions["viewportWidth"], f"{label} document overflow: {dimensions}"
    assert dimensions["bodyWidth"] <= dimensions["viewportWidth"], f"{label} body overflow: {dimensions}"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, **({"executable_path": chrome_path()} if chrome_path() else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    state = {
        "project_stage": "RESEARCH",
        "draft": {
            "id": DRAFT_ID,
            "workspaceId": "workspace-1",
            "projectId": PROJECT_ID,
            "platform": "WECHAT",
            "status": "EDITING",
            "revision": 1,
            "title": "",
            "body": "",
            "visualPlan": {},
            "layoutTemplateVersionId": None,
            "sourceDraftVersionId": None,
            "sourceStale": False,
            "currentVersionId": None,
            "assets": [],
            "createdAt": NOW,
            "updatedAt": NOW,
        },
        "unexpected": [],
        "console_errors": [],
        "requests": [],
    }
    page.on("console", lambda message: state["console_errors"].append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: state["console_errors"].append(str(error)))
    page.add_init_script("window.localStorage.setItem('content-engine-web-session-v1', " + json.dumps(json.dumps(SESSION, ensure_ascii=False)) + ");")

    template = {
        "id": TEMPLATE_ID,
        "workspaceId": "workspace-1",
        "name": "清爽阅读",
        "kind": "SYSTEM",
        "status": "ACTIVE",
        "currentVersionId": TEMPLATE_VERSION_ID,
        "currentVersionNumber": 1,
        "rules": layout_rules(),
        "sourceUrl": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }

    def current_project():
        return project(state["project_stage"])

    def patch_draft(payload):
        assert payload["revision"] == state["draft"]["revision"], payload
        for key in ("title", "body", "visualPlan", "layoutTemplateVersionId"):
            if key in payload:
                state["draft"][key] = payload[key]
        state["draft"]["revision"] += 1
        state["draft"]["updatedAt"] = NOW

    def handle_api(route):
        request = route.request
        path = urlparse(request.url).path
        method = request.method
        state["requests"].append(f"{method} {path}")
        if path == "/api/v1/auth/me" and method == "GET":
            return respond(route, SESSION)
        assert request.headers.get("x-workspace-id") == SESSION["activeWorkspaceId"], f"{method} {path} missing workspace header"
        if path == "/api/v1/workspace/state" and method == "GET":
            return respond(route, {"workspace": SESSION["workspaces"][0], "state": {"workspace": {"name": "内容工作室", "enabledPlatforms": ["WECHAT"], "setupCompleted": True}, "sources": [], "intelligence": [], "topics": [], "projects": [current_project()]}, "revision": 1, "updatedAt": NOW})
        if path == "/api/v1/creative/projects" and method == "GET":
            return respond(route, {"projects": [current_project()]})
        if path in ("/api/v1/intelligence/sources", "/api/v1/intelligence/items") and method == "GET":
            return respond(route, [])
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/planning" and method == "GET":
            return respond(route, {"project": current_project(), "planning": current_project()["planning"]})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/materials" and method == "GET":
            return respond(route, {"inputs": [], "references": [], "assets": []})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/agent" and method == "GET":
            requested_stage = "COPY" if "stage=COPY" in request.url else "RESEARCH"
            return respond(route, {"stage": requested_stage, "platform": "WECHAT" if requested_stage == "COPY" else None, "messages": [], "summaries": [], "activeRun": None, "artifacts": [], "usedMaterialIds": {"inputIds": [], "referenceIds": [], "assetIds": []}})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/research/skip" and method == "POST":
            state["project_stage"] = "MASTER_WRITING"
            return respond(route, {"project": current_project()})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/drafts" and method == "GET":
            return respond(route, {"drafts": [state["draft"]]})
        if path == "/api/v1/creative/skills" and method == "GET":
            return respond(route, [])
        if path == "/api/v1/account-voices" and method == "GET":
            return respond(route, {"voices": []})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "GET":
            return respond(route, {"brief": {"objective": "建立核验方法", "targetAudience": "内容创作者", "coreMessage": "先验证再判断", "sourceRequirements": "公开资料", "lengthTarget": "1500-2500 字", "selectedPlatforms": ["WECHAT"], "notes": "", "selectedSkills": {"SUBJECT": "", "CONTENT_TYPE": "", "VOICE": "", "LAYOUT": "", "CHANNEL": ""}, "platformSkills": {"WECHAT": {"LAYOUT": "", "CHANNEL": "", "lengthTarget": "1500-2500 字"}}, "accountVoiceProfileId": "", "voiceOffset": "DEFAULT"}})
        if path == f"/api/v1/content-drafts/{DRAFT_ID}" and method == "PATCH":
            patch_draft(request.post_data_json)
            return respond(route, state["draft"])
        if path == f"/api/v1/content-drafts/{DRAFT_ID}/assets" and method == "PUT":
            payload = request.post_data_json
            assert payload["revision"] == state["draft"]["revision"], payload
            state["draft"]["assets"] = []
            state["draft"]["revision"] += 1
            return respond(route, state["draft"])
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/visual/plan" and method == "POST":
            visual = {"id": "cover", "role": "COVER", "visualType": "HERO_VISUAL", "title": "文章封面", "purpose": "概括核心观点", "size": "16:9", "insertAfter": None, "informationPoints": ["先验证再判断"], "searchQueries": ["AI tool verification workflow"], "sourceExcerpt": "", "contentBlocks": [], "avoidConcepts": ["文字海报"], "prompt": "editorial photograph of a creator verifying an AI workflow", "references": [], "assetId": None}
            return respond(route, {"plan": [visual], "strategy": "公众号内容型配图", "policy": {"scope": "WECHAT_VISUAL_PLANNING", "provider": "BAILIAN_CLI", "connectionId": None, "model": "qwen-max", "promptVersion": "wechat-visual:1"}})
        if path == "/api/v1/wechat-layout-templates" and method == "GET":
            return respond(route, {"templates": [template]})
        if path == f"/api/v1/wechat-layout-templates/{TEMPLATE_ID}/preview" and method == "POST":
            html = f"<!doctype html><html><body><article><h1>{state['draft']['title']}</h1><p>{state['draft']['body']}</p></article></body></html>"
            return respond(route, {"templateId": TEMPLATE_ID, "templateVersionId": TEMPLATE_VERSION_ID, "draftId": DRAFT_ID, "html": html, "checks": []})
        if path == f"/api/v1/content-drafts/{DRAFT_ID}/complete" and method == "POST":
            assert request.post_data_json == {"revision": state["draft"]["revision"]}
            state["draft"]["status"] = "READY"
            state["draft"]["currentVersionId"] = "ready-version"
            version = {"id": "ready-version", "workspaceId": "workspace-1", "draftId": DRAFT_ID, "platform": "WECHAT", "versionNumber": 1, "title": state["draft"]["title"], "body": state["draft"]["body"], "visualPlan": state["draft"]["visualPlan"], "renderedHtml": "<article>ready</article>", "layoutTemplateVersionId": TEMPLATE_VERSION_ID, "sourceDraftVersionId": None, "generationRunId": None, "assets": [], "createdAt": NOW}
            return respond(route, {"draft": state["draft"], "version": version})
        if path == f"/api/v1/content-drafts/{DRAFT_ID}/versions" and method == "GET":
            return respond(route, {"versions": [{"id": "ready-version", "workspaceId": "workspace-1", "draftId": DRAFT_ID, "platform": "WECHAT", "versionNumber": 1, "title": state["draft"]["title"], "body": state["draft"]["body"], "visualPlan": state["draft"]["visualPlan"], "renderedHtml": "<article>ready</article>", "layoutTemplateVersionId": TEMPLATE_VERSION_ID, "sourceDraftVersionId": None, "generationRunId": None, "assets": [], "createdAt": NOW}]})
        state["unexpected"].append(f"{method} {path}")
        return respond(route, {"error": {"message": f"unhandled {method} {path}"}}, status=418)

    page.route("**/api/v1/**", handle_api)
    page.goto(f"{BASE_URL}/?view=create&project={PROJECT_ID}&stage=preparation&platform=XIAOHONGSHU")
    page.wait_for_load_state("networkidle")
    assert "platform=" not in page.url
    assert page.locator(".creative-stage-nav button").count() == 5
    page.get_by_role("button", name="开始公众号正文", exact=True).wait_for()
    assert_no_overflow(page, "preparation desktop")
    page.reload(); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="开始公众号正文", exact=True).click()

    page.locator(".copy-editor").wait_for()
    assert "stage=copy" in page.url
    page.reload(); page.wait_for_load_state("networkidle")
    page.locator(".copy-editor").wait_for()
    page.get_by_label("标题", exact=True).fill("普通人如何核验 AI 工具的真实价值")
    body = "真正有价值的工具，必须在具体任务中稳定产出可以验证的结果。" * 6
    page.get_by_label("正文", exact=True).fill(body)
    page.get_by_role("button", name="确认正文，开始配图", exact=True).click()

    page.get_by_role("heading", name="公众号配图", exact=True).wait_for()
    assert "stage=visual" in page.url
    page.reload(); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="生成配图方案", exact=True).click()
    page.get_by_role("button", name="确认素材，进入排版", exact=True).wait_for()
    page.get_by_role("button", name="确认素材，进入排版", exact=True).click()

    page.get_by_role("heading", name="公众号排版", exact=True).wait_for()
    assert "stage=layout" in page.url
    page.reload(); page.wait_for_load_state("networkidle")
    page.locator(".wechat-layout-workspace").wait_for()
    assert_no_overflow(page, "layout desktop")
    page.get_by_role("button", name="保存公众号草稿", exact=True).click()

    page.get_by_role("heading", name="公众号草稿已完成", exact=True).wait_for()
    assert "stage=drafts" in page.url
    page.reload(); page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="公众号草稿已完成", exact=True).wait_for()
    assert page.get_by_text("公众号母稿", exact=True).count() >= 1
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "draft result mobile")
    nav_metrics = page.locator(".creative-stage-nav").evaluate("""element => {
        const bounds = element.getBoundingClientRect();
        return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            left: bounds.left,
            right: bounds.right,
            buttons: [...element.querySelectorAll('button')].map((button) => {
                const buttonBounds = button.getBoundingClientRect();
                return { left: buttonBounds.left, right: buttonBounds.right };
            }),
        };
    }""")
    assert nav_metrics["scrollWidth"] <= nav_metrics["clientWidth"], nav_metrics
    assert all(button["left"] >= nav_metrics["left"] - 1 and button["right"] <= nav_metrics["right"] + 1 for button in nav_metrics["buttons"]), nav_metrics
    title_metrics = page.locator(".draft-result-workspace dl>div:first-child dd").evaluate("""element => {
        const style = getComputedStyle(element);
        return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            lineHeight: Number.parseFloat(style.lineHeight),
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
        };
    }""")
    assert title_metrics["scrollWidth"] <= title_metrics["clientWidth"] + 1, title_metrics
    assert title_metrics["clientHeight"] > title_metrics["lineHeight"] * 1.5, title_metrics
    assert title_metrics["overflow"] == "visible" and title_metrics["textOverflow"] != "ellipsis" and title_metrics["whiteSpace"] == "normal", title_metrics
    page.screenshot(path=ARTIFACTS / "linear-workflow-mobile.png", full_page=True)
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
