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
XIAOHONGSHU_DRAFT_ID = "44444444-4444-4444-8444-444444444444"
ADAPTATION_RUN_ID = "55555555-5555-4555-8555-555555555555"
ASSET_A_ID = "66666666-6666-4666-8666-666666666666"
ASSET_B_ID = "77777777-7777-4777-8777-777777777777"
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


def workspace_asset(asset_id, title):
    return {
        "id": asset_id,
        "kind": "IMAGE",
        "origin": "UPLOAD",
        "status": "ACTIVE",
        "title": title,
        "originalFilename": f"{title}.svg",
        "mimeType": "image/svg+xml",
        "sizeBytes": 320,
        "sha256": asset_id.replace("-", "") * 2,
        "sourceUrl": None,
        "sourceNote": "验收素材",
        "copyrightStatus": "OWNED",
        "projectCount": 1,
        "createdAt": NOW,
        "updatedAt": NOW,
    }


def project_asset(asset_id, title, platform="XIAOHONGSHU"):
    return {
        **workspace_asset(asset_id, title),
        "linkId": f"link-{asset_id}",
        "projectId": PROJECT_ID,
        "role": "VISUAL",
        "scope": "IMAGING",
        "platforms": [platform],
        "notes": "验收素材",
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
        "derived": None,
        "adaptation_status": "DRAFT",
        "adaptation_polls": 0,
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

    def patch_draft(payload, target=None):
        target = target or state["draft"]
        assert payload["revision"] == target["revision"], payload
        for key in ("title", "body", "visualPlan", "layoutTemplateVersionId"):
            if key in payload:
                target[key] = payload[key]
        target["revision"] += 1
        target["updatedAt"] = NOW

    def ensure_derived():
        if state["derived"]:
            return state["derived"]
        state["derived"] = {
            "id": XIAOHONGSHU_DRAFT_ID,
            "workspaceId": "workspace-1",
            "projectId": PROJECT_ID,
            "platform": "XIAOHONGSHU",
            "status": "EDITING",
            "revision": 1,
            "title": "核验 AI 工具价值的三个步骤",
            "body": "先把工具放进真实任务，再记录成本，最后核对结果。",
            "visualPlan": {"adaptation": {"promptVersion": "draft-adaptation:1.0.0", "imageSuggestions": [{"sourceAssetId": None, "purpose": "真实创作流程", "preferredRatio": "3:4", "needsNewImage": True}]}},
            "layoutTemplateVersionId": None,
            "sourceDraftVersionId": "ready-version",
            "sourceStale": False,
            "currentVersionId": None,
            "assets": [],
            "createdAt": NOW,
            "updatedAt": NOW,
        }
        return state["derived"]

    def replace_assets(target, payload):
        assert payload["revision"] == target["revision"], payload
        target["assets"] = [{
            "id": f"draft-asset-{index}",
            "workspaceId": "workspace-1",
            "draftId": target["id"],
            "draftVersionId": None,
            "assetId": item["assetId"],
            "role": item["role"],
            "sortOrder": index,
            "createdAt": NOW,
        } for index, item in enumerate(payload["assets"])]
        target["revision"] += 1
        target["updatedAt"] = NOW

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
            return respond(route, {"drafts": [state["draft"]] + ([state["derived"]] if state["derived"] else [])})
        if path == "/api/v1/creative/skills" and method == "GET":
            return respond(route, [])
        if path == "/api/v1/account-voices" and method == "GET":
            return respond(route, {"voices": []})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "GET":
            return respond(route, {"brief": {"objective": "建立核验方法", "targetAudience": "内容创作者", "coreMessage": "先验证再判断", "sourceRequirements": "公开资料", "lengthTarget": "1500-2500 字", "selectedPlatforms": ["WECHAT"], "notes": "", "selectedSkills": {"SUBJECT": "", "CONTENT_TYPE": "", "VOICE": "", "LAYOUT": "", "CHANNEL": ""}, "platformSkills": {"WECHAT": {"LAYOUT": "", "CHANNEL": "", "lengthTarget": "1500-2500 字"}}, "accountVoiceProfileId": "", "voiceOffset": "DEFAULT"}})
        if path == f"/api/v1/content-drafts/{DRAFT_ID}" and method == "PATCH":
            patch_draft(request.post_data_json)
            return respond(route, state["draft"])
        if path == f"/api/v1/content-drafts/{XIAOHONGSHU_DRAFT_ID}" and method == "PATCH":
            target = ensure_derived()
            patch_draft(request.post_data_json, target)
            return respond(route, target)
        if path == f"/api/v1/content-drafts/{DRAFT_ID}/assets" and method == "PUT":
            payload = request.post_data_json
            replace_assets(state["draft"], payload)
            return respond(route, state["draft"])
        if path == f"/api/v1/content-drafts/{XIAOHONGSHU_DRAFT_ID}/assets" and method == "PUT":
            target = ensure_derived()
            replace_assets(target, request.post_data_json)
            return respond(route, target)
        if path == f"/api/v1/content-drafts/{DRAFT_ID}/derive" and method == "POST":
            assert request.post_data_json == {"platform": "XIAOHONGSHU"}
            state["adaptation_status"] = "DRAFT"
            state["adaptation_polls"] = 0
            return respond(route, {
                "id": ADAPTATION_RUN_ID,
                "status": "DRAFT",
                "confirmation": {
                    "platform": "XIAOHONGSHU",
                    "sourceDraftVersionId": "ready-version",
                    "sourceAssetCount": len(state["draft"]["assets"]),
                    "policy": {"scope": "XIAOHONGSHU_ADAPTATION", "provider": "BAILIAN_CLI", "connectionId": None, "model": "qwen-max", "promptVersion": "draft-adaptation:1.0.0"},
                },
            })
        if path == f"/api/v1/content-draft-adaptation-runs/{ADAPTATION_RUN_ID}/confirm" and method == "POST":
            state["adaptation_status"] = "QUEUED"
            return respond(route, {"id": ADAPTATION_RUN_ID, "status": "QUEUED", "jobId": "job-adaptation-1"}, status=202)
        if path == f"/api/v1/content-draft-adaptation-runs/{ADAPTATION_RUN_ID}/cancel" and method == "POST":
            state["adaptation_status"] = "CANCELLED"
            return respond(route, {"id": ADAPTATION_RUN_ID, "status": "CANCELLED"})
        if path == f"/api/v1/content-draft-adaptation-runs/{ADAPTATION_RUN_ID}" and method == "GET":
            state["adaptation_polls"] += 1
            if state["adaptation_polls"] == 1:
                state["adaptation_status"] = "RUNNING"
                return respond(route, {"id": ADAPTATION_RUN_ID, "status": "RUNNING", "jobId": "job-adaptation-1"})
            state["adaptation_status"] = "SUCCEEDED"
            ensure_derived()
            return respond(route, {"id": ADAPTATION_RUN_ID, "status": "SUCCEEDED", "jobId": "job-adaptation-1", "result": {"draftId": XIAOHONGSHU_DRAFT_ID, "platform": "XIAOHONGSHU"}})
        if path == "/api/v1/assets" and method == "GET":
            return respond(route, {"assets": [workspace_asset(ASSET_A_ID, "创作者核验工作流"), workspace_asset(ASSET_B_ID, "真实任务记录表")]})
        for asset_id, title in ((ASSET_A_ID, "创作者核验工作流"), (ASSET_B_ID, "真实任务记录表")):
            if path == f"/api/v1/assets/{asset_id}" and method == "GET":
                return respond(route, workspace_asset(asset_id, title))
            if path == f"/api/v1/assets/{asset_id}/content" and method == "GET":
                color = "#dceeff" if asset_id == ASSET_A_ID else "#dff5e9"
                svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="{color}"/><rect x="80" y="120" width="440" height="520" fill="#ffffff" stroke="#17203b" stroke-width="8"/><circle cx="300" cy="290" r="90" fill="#1e5bff"/><path d="M160 500h280M160 550h210" stroke="#17203b" stroke-width="18"/></svg>'
                return route.fulfill(status=200, content_type="image/svg+xml", body=svg)
            if path == f"/api/v1/projects/{PROJECT_ID}/assets/{asset_id}" and method == "POST":
                return respond(route, project_asset(asset_id, title))
        if path == "/api/v1/models/task-policies" and method == "GET":
            return respond(route, [{"task": "TEXT_TO_IMAGE", "provider": "BAILIAN_CLI", "model": "qwen-image-2.0"}, {"task": "IMAGE_TO_IMAGE", "provider": "BAILIAN_CLI", "model": "qwen-image-2.0"}])
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

    # 先保留公众号五步流程的移动端验收，再进入不带步骤导航的平台编辑器。
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
    page.set_viewport_size({"width": 1440, "height": 1000})

    page.get_by_role("button", name="生成小红书草稿", exact=True).click()
    page.get_by_text("XIAOHONGSHU_ADAPTATION", exact=True).wait_for()
    assert page.get_by_text("BAILIAN_CLI", exact=True).count() >= 1
    assert page.get_by_text("qwen-max", exact=True).count() >= 1
    assert state["adaptation_status"] == "DRAFT"
    page.get_by_role("button", name="确认策略并生成", exact=True).click()
    try:
        page.get_by_role("heading", name="小红书草稿编辑", exact=True).wait_for(timeout=15000)
    except Exception:
        page.screenshot(path=ARTIFACTS / "platform-draft-editor-timeout.png", full_page=True)
        print(json.dumps({"requests": state["requests"], "unexpected": state["unexpected"], "adaptationStatus": state["adaptation_status"], "adaptationPolls": state["adaptation_polls"], "derived": state["derived"]}, ensure_ascii=False, indent=2))
        raise
    assert f"draft={XIAOHONGSHU_DRAFT_ID}" in page.url
    assert page.locator(".creative-stage-nav").count() == 0
    assert page.get_by_text("配图", exact=True).count() == 0
    assert page.get_by_text("排版", exact=True).count() == 0
    assert page.get_by_text("审核", exact=True).count() == 0

    edited_title = "真实任务核验 AI 工具的三个步骤"
    edited_body = "第一步进入真实任务，第二步记录时间和成本，第三步核对结果是否稳定。" * 4
    page.get_by_label("小红书标题", exact=True).fill(edited_title)
    page.get_by_label("小红书正文", exact=True).fill(edited_body)
    page.get_by_role("button", name="选择素材", exact=True).click()
    picker = page.locator(".asset-picker-dialog")
    picker.get_by_role("button", name="预览", exact=True).first.click()
    page.locator(".asset-preview-dialog").wait_for()
    page.get_by_role("button", name="关闭素材预览", exact=True).click()
    picker.get_by_role("button", name="选择", exact=True).first.click()
    page.locator(".platform-image-item").wait_for()
    page.locator(".platform-image-item img").wait_for()
    page.get_by_role("button", name="预览第 1 张图片", exact=True).click()
    page.locator(".asset-preview-dialog .asset-preview-image").wait_for()
    page.get_by_role("button", name="关闭素材预览", exact=True).click()

    page.get_by_role("button", name="选择素材", exact=True).click()
    page.locator(".asset-picker-dialog").get_by_role("button", name="选择", exact=True).first.click()
    page.locator(".platform-image-item").nth(1).wait_for()
    page.get_by_role("button", name="上移第 2 张图片", exact=True).click()
    page.wait_for_timeout(200)
    assert state["derived"]["assets"][0]["assetId"] == ASSET_B_ID, state["derived"]["assets"]
    page.get_by_label("图片 1 裁切比例", exact=True).select_option("1:1")
    page.get_by_role("button", name="删除第 2 张图片", exact=True).click()
    page.wait_for_timeout(800)
    assert state["derived"]["title"] == edited_title
    assert state["derived"]["body"] == edited_body
    assert [item["assetId"] for item in state["derived"]["assets"]] == [ASSET_B_ID]

    page.get_by_role("button", name="AI 生图任务", exact=True).click()
    page.get_by_text("TEXT_TO_IMAGE", exact=True).wait_for()
    page.get_by_text("qwen-image-2.0", exact=True).wait_for()
    assert "POST /api/v1/creative/projects/%s/visual/generate" % PROJECT_ID not in state["requests"]

    page.reload(); page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="小红书草稿编辑", exact=True).wait_for()
    assert page.get_by_label("小红书标题", exact=True).input_value() == edited_title
    assert page.get_by_label("小红书正文", exact=True).input_value() == edited_body
    assert page.locator(".platform-image-item").count() == 1
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert page.locator(".creative-stage-nav").count() == 0
    assert_no_overflow(page, "platform draft editor mobile")
    page.screenshot(path=ARTIFACTS / "platform-draft-editor-mobile.png", full_page=True)
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
