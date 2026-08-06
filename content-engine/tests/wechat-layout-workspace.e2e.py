import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("CONTENT_ENGINE_E2E_URL", "http://127.0.0.1:5173")
ARTIFACTS = Path(tempfile.gettempdir()) / "content-engine-wechat-layout-e2e"
ARTIFACTS.mkdir(exist_ok=True)
PROJECT_ID = "layout-project-1"
DRAFT_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"
NOW = "2026-08-02T08:00:00.000Z"
ARTICLE_BODY = """## 为什么要建立核验流程

真正有价值的工具，必须在具体任务中稳定产出可验证结果。核验时要记录任务目标、输入条件、执行过程和最终结果，不能只看一次演示就下结论。

> 先核对来源，再形成判断。

只有同一套标准能够重复执行，工具的效率、准确性和适用边界才有比较意义。"""
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


def project():
    return {
        "id": PROJECT_ID,
        "title": "普通人如何核验 AI 工具的真实价值",
        "originType": "MANUAL",
        "stage": "LAYOUT",
        "status": "WRITING",
        "planning": {"title": "普通人如何核验 AI 工具的真实价值", "category": "AI 工具", "angle": "真实任务核验", "objective": "建立可复用方法", "targetAudience": "内容创作者", "coreMessage": "先验证再判断", "targetPlatforms": ["WECHAT"], "timing": "EVERGREEN", "sourceRequirements": "公开资料", "constraints": "不夸大"},
        "planningVersion": 1,
        "coreViewpoint": "工具价值必须由真实任务验证。",
        "factChecks": [],
        "versions": [{"id": "legacy-version-1", "platform": "WECHAT", "title": "普通人如何核验 AI 工具的真实价值", "body": ARTICLE_BODY, "status": "PREFLIGHT_PASSED", "updatedAt": NOW}],
        "sourceSnapshot": {},
        "delivery": {"platforms": {"WECHAT": {"stage": "LAYOUT", "visual": None, "layout": None, "review": None}}},
        "createdAt": NOW,
        "updatedAt": NOW,
    }


def draft(status="EDITING"):
    return {
        "id": DRAFT_ID,
        "workspaceId": "workspace-1",
        "projectId": PROJECT_ID,
        "platform": "WECHAT",
        "status": status,
        "revision": 4 if status == "EDITING" else 5,
        "title": "普通人如何核验 AI 工具的真实价值",
        "body": ARTICLE_BODY,
        "visualPlan": {"workflowStatus": "COMPLETE", "items": []},
        "layoutTemplateVersionId": "40000001-0000-4000-8000-000000000001",
        "sourceDraftVersionId": None,
        "sourceStale": False,
        "currentVersionId": "version-ready" if status == "READY" else None,
        "assets": [{"id": "asset-link-1", "workspaceId": "workspace-1", "draftId": DRAFT_ID, "draftVersionId": None, "assetId": ASSET_ID, "role": "COVER", "sortOrder": 0, "createdAt": NOW}],
        "createdAt": NOW,
        "updatedAt": NOW,
    }


SYSTEM_TEMPLATE_RULES = [
    {"schemaVersion": 1, "canvas": {"background": "#ffffff", "textColor": "#273444", "maxWidth": 677}, "title": {"fontSize": 31, "fontWeight": 800, "lineHeight": 1.32, "color": "#102a43"}, "body": {"fontSize": 16, "lineHeight": 1.95, "paragraphSpacing": 20}, "heading": {"fontSize": 21, "color": "#2563eb", "borderColor": "#60a5fa"}, "quote": {"background": "#f8fafc", "borderColor": "#93c5fd"}, "image": {"borderRadius": 12, "spacing": 22, "captionColor": "#64748b"}, "divider": {"color": "#dbeafe", "thickness": 1}, "layout": {"titleVariant": "label", "headingVariant": "left-bar", "imageVariant": "framed", "quoteVariant": "card", "dividerVariant": "dots", "leadVariant": "stripe", "tocVariant": "bullets", "listVariant": "spaced", "linkVariant": "accent", "tagVariant": "chips", "metaVariant": "muted", "paragraphVariant": "indent"}},
    {"schemaVersion": 1, "canvas": {"background": "#ffffff", "textColor": "#243044", "maxWidth": 677}, "title": {"fontSize": 30, "fontWeight": 800, "lineHeight": 1.28, "color": "#172554"}, "body": {"fontSize": 16, "lineHeight": 1.82, "paragraphSpacing": 16}, "heading": {"fontSize": 20, "color": "#1e3a8a", "borderColor": "#1e3a8a"}, "quote": {"background": "#eff6ff", "borderColor": "#3b82f6"}, "image": {"borderRadius": 0, "spacing": 18, "captionColor": "#64748b"}, "divider": {"color": "#94a3b8", "thickness": 2}, "layout": {"titleVariant": "split", "headingVariant": "numbered", "imageVariant": "framed", "quoteVariant": "outline", "dividerVariant": "label", "leadVariant": "card", "tocVariant": "index", "listVariant": "check", "linkVariant": "pill", "tagVariant": "rail", "metaVariant": "chips", "paragraphVariant": "report"}},
    {"schemaVersion": 1, "canvas": {"background": "#ffffff", "textColor": "#111827", "maxWidth": 677}, "title": {"fontSize": 32, "fontWeight": 900, "lineHeight": 1.24, "color": "#050816"}, "body": {"fontSize": 16, "lineHeight": 1.9, "paragraphSpacing": 20}, "heading": {"fontSize": 21, "color": "#111827", "borderColor": "#ff4d2e"}, "quote": {"background": "#fff1ec", "borderColor": "#ff8a70"}, "image": {"borderRadius": 10, "spacing": 22, "captionColor": "#475569"}, "divider": {"color": "#e5e7eb", "thickness": 1}, "layout": {"titleVariant": "news", "headingVariant": "shadow-card", "imageVariant": "shadow", "quoteVariant": "card", "dividerVariant": "line", "leadVariant": "none", "tocVariant": "card", "listVariant": "bold", "linkVariant": "accent", "tagVariant": "mono", "metaVariant": "muted", "paragraphVariant": "rail"}},
    {"schemaVersion": 1, "canvas": {"background": "#fffdf8", "textColor": "#3f3a34", "maxWidth": 677}, "title": {"fontSize": 31, "fontWeight": 700, "lineHeight": 1.42, "color": "#292524"}, "body": {"fontSize": 17, "lineHeight": 2.05, "paragraphSpacing": 22}, "heading": {"fontSize": 21, "color": "#9a3412", "borderColor": "#c08457"}, "quote": {"background": "#faf5ed", "borderColor": "#d6b38a"}, "image": {"borderRadius": 4, "spacing": 24, "captionColor": "#78716c"}, "divider": {"color": "#d6b38a", "thickness": 1}, "layout": {"titleVariant": "card", "headingVariant": "stamp", "imageVariant": "framed", "quoteVariant": "bubble", "dividerVariant": "dots", "leadVariant": "kicker", "tocVariant": "none", "listVariant": "spaced", "linkVariant": "plain", "tagVariant": "rail", "metaVariant": "muted", "paragraphVariant": "indent"}},
    {"schemaVersion": 1, "canvas": {"background": "#ffffff", "textColor": "#202020", "maxWidth": 677}, "title": {"fontSize": 34, "fontWeight": 900, "lineHeight": 1.16, "color": "#111111"}, "body": {"fontSize": 16, "lineHeight": 1.78, "paragraphSpacing": 16}, "heading": {"fontSize": 22, "color": "#111111", "borderColor": "#111111"}, "quote": {"background": "#f5f5f5", "borderColor": "#4b5563"}, "image": {"borderRadius": 0, "spacing": 18, "captionColor": "#5f6368"}, "divider": {"color": "#111111", "thickness": 3}, "layout": {"titleVariant": "bar", "headingVariant": "center-underline", "imageVariant": "cutout", "quoteVariant": "outline", "dividerVariant": "label", "leadVariant": "stripe", "tocVariant": "index", "listVariant": "bold", "linkVariant": "accent", "tagVariant": "mono", "metaVariant": "none", "paragraphVariant": "newspaper"}},
    {"schemaVersion": 1, "canvas": {"background": "#ffffff", "textColor": "#263238", "maxWidth": 677}, "title": {"fontSize": 30, "fontWeight": 800, "lineHeight": 1.34, "color": "#102a43"}, "body": {"fontSize": 16, "lineHeight": 1.98, "paragraphSpacing": 20}, "heading": {"fontSize": 21, "color": "#0f766e", "borderColor": "#14b8a6"}, "quote": {"background": "#f0fdfa", "borderColor": "#5eead4"}, "image": {"borderRadius": 8, "spacing": 20, "captionColor": "#52606d"}, "divider": {"color": "#99f6e4", "thickness": 1}, "layout": {"titleVariant": "label", "headingVariant": "band", "imageVariant": "poster", "quoteVariant": "card", "dividerVariant": "dots", "leadVariant": "card", "tocVariant": "card", "listVariant": "check", "linkVariant": "pill", "tagVariant": "chips", "metaVariant": "chips", "paragraphVariant": "card"}},
]


def template(index):
    names = ["清爽阅读", "商务报告", "科技媒体", "人文杂志", "现代报刊", "知识长文"]
    return {
        "id": f"3000000{index + 1}-0000-4000-8000-{index + 1:012d}",
        "workspaceId": "workspace-1",
        "name": names[index],
        "kind": "SYSTEM",
        "status": "ACTIVE",
        "currentVersionId": f"4000000{index + 1}-0000-4000-8000-{index + 1:012d}",
        "currentVersionNumber": 1,
        "rules": SYSTEM_TEMPLATE_RULES[index],
        "sourceUrl": None,
        "createdAt": NOW,
        "updatedAt": NOW,
    }


def preview_html(name):
    return f'<article style="max-width:677px;margin:0 auto;padding:24px 18px;background:#fff;color:#1f2937"><h1 style="font-size:30px">{name}</h1><figure data-asset-id="{ASSET_ID}"><img src="/api/v1/assets/{ASSET_ID}/content" style="display:block;width:100%;height:auto"></figure><h2 style="color:#1d4ed8">为什么要建立核验流程</h2><p>真正有价值的工具，必须在具体任务中稳定产出可验证结果。</p></article>'


def assert_no_overflow(page, label):
    dimensions = page.evaluate("""() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, body: document.body.scrollWidth })""")
    assert dimensions["width"] <= dimensions["viewport"], f"{label} document overflow: {dimensions}"
    assert dimensions["body"] <= dimensions["viewport"], f"{label} body overflow: {dimensions}"


def rectangles_overlap(first, second):
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def visible_ratio(container, child):
    left = max(container["x"], child["x"])
    top = max(container["y"], child["y"])
    right = min(container["x"] + container["width"], child["x"] + child["width"])
    bottom = min(container["y"] + container["height"], child["y"] + child["height"])
    visible_area = max(0, right - left) * max(0, bottom - top)
    return visible_area / (container["width"] * container["height"])


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, **({"executable_path": chrome_path()} if chrome_path() else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    state = {"unexpected": [], "console_errors": [], "completed": 0, "layout_designs": 0, "designed_template_id": None, "asset_reads": 0, "unauthenticated_asset_reads": 0, "current_revision": 4}
    page.on("console", lambda message: state["console_errors"].append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: state["console_errors"].append(str(error)))
    page.add_init_script("window.localStorage.setItem('content-engine-web-session-v1', " + json.dumps(json.dumps(SESSION, ensure_ascii=False)) + ");")

    templates = [template(index) for index in range(6)]

    def handle_api(route):
        request = route.request
        path = urlparse(request.url).path
        method = request.method
        if path == "/api/v1/auth/me":
            return respond(route, SESSION)
        if path == f"/api/v1/assets/{ASSET_ID}/content" and method == "GET":
            if request.headers.get("x-workspace-id") == SESSION["activeWorkspaceId"]:
                state["asset_reads"] += 1
            else:
                state["unauthenticated_asset_reads"] += 1
            svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#dceeff"/><rect x="80" y="90" width="1040" height="495" fill="#fff1c7" stroke="#17203b" stroke-width="8"/><circle cx="600" cy="338" r="150" fill="#1e5bff"/><circle cx="600" cy="338" r="68" fill="#ffd53d"/></svg>'
            return route.fulfill(status=200, content_type="image/svg+xml", body=svg)
        assert request.headers.get("x-workspace-id") == SESSION["activeWorkspaceId"], f"{method} {path} missing workspace header"
        if path == "/api/v1/workspace/state" and method == "GET":
            return respond(route, {"workspace": SESSION["workspaces"][0], "state": {"workspace": {"name": "内容工作室", "enabledPlatforms": ["WECHAT"], "setupCompleted": True}, "sources": [], "intelligence": [], "topics": [], "projects": [project()]}, "revision": 1, "updatedAt": NOW})
        if path == "/api/v1/creative/projects" and method == "GET":
            return respond(route, {"projects": [project()]})
        if path == "/api/v1/creative/skills" and method == "GET":
            return respond(route, [])
        if path == "/api/v1/account-voices" and method == "GET":
            return respond(route, {"voices": []})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "GET":
            return respond(route, {"brief": {"objective": "建立核验方法", "targetAudience": "内容创作者", "coreMessage": "先验证再判断", "sourceRequirements": "公开资料", "lengthTarget": "1500-2500 字", "selectedPlatforms": ["WECHAT"], "notes": "", "selectedSkills": {"SUBJECT": "", "CONTENT_TYPE": "", "VOICE": "", "LAYOUT": "", "CHANNEL": ""}, "platformSkills": {"WECHAT": {"LAYOUT": "", "CHANNEL": "", "lengthTarget": "1500-2500 字"}}, "accountVoiceProfileId": "", "voiceOffset": "DEFAULT"}})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "PUT":
            return respond(route, {"brief": request.post_data_json})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/drafts" and method == "GET":
            return respond(route, {"drafts": [draft()]})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/agent" and method == "GET":
            return respond(route, {"stage": "COPY", "platform": "WECHAT", "messages": [], "summaries": [], "activeRun": None, "artifacts": [], "usedMaterialIds": {"inputIds": [], "referenceIds": [], "assetIds": []}})
        if path == "/api/v1/wechat-layout-templates" and method == "GET":
            return respond(route, {"templates": templates})
        if path.endswith("/preview") and path.startswith("/api/v1/wechat-layout-templates/") and method == "POST":
            template_id = path.split("/")[-2]
            selected = next(item for item in templates if item["id"] == template_id)
            if state["designed_template_id"] == template_id:
                return respond(route, {
                    "templateId": selected["id"],
                    "templateVersionId": selected["currentVersionId"],
                    "draftId": DRAFT_ID,
                    "html": f'<article style="max-width:677px;margin:0 auto;padding:24px 18px;background:#fff;color:#1f2937"><h1>{selected["name"]}</h1><p data-layout-design-block="callout"><strong>真实价值</strong>来自真实任务。</p><figure data-asset-id="{ASSET_ID}"><img src="/api/v1/assets/{ASSET_ID}/content"></figure></article>',
                    "checks": [],
                })
            return respond(route, {"templateId": selected["id"], "templateVersionId": selected["currentVersionId"], "draftId": DRAFT_ID, "html": preview_html(selected["name"]), "checks": []})
        if path == f"/api/v1/creative/drafts/{DRAFT_ID}/layout/design" and method == "POST":
            payload = request.post_data_json
            selected = next(item for item in templates if item["id"] == payload["templateId"])
            state["layout_designs"] += 1
            state["designed_template_id"] = selected["id"]
            state["current_revision"] = 5
            designed = draft()
            designed["revision"] = state["current_revision"]
            designed["visualPlan"] = {"workflowStatus": "COMPLETE", "items": [], "layoutDesign": {"schemaVersion": 1, "templateId": selected["id"], "templateVersionId": selected["currentVersionId"], "blocks": [{"paragraphIndex": 1, "role": "lead", "variant": "callout", "label": "结论"}], "inlineMarks": [{"text": "真实价值", "type": "strong-accent"}]}}
            return respond(route, {
                "draft": designed,
                "templateId": selected["id"],
                "templateVersionId": selected["currentVersionId"],
                "draftId": DRAFT_ID,
                "layoutDesign": designed["visualPlan"]["layoutDesign"],
                "html": f'<article style="max-width:677px;margin:0 auto;padding:24px 18px;background:#fff;color:#1f2937"><h1>{selected["name"]}</h1><p data-layout-design-block="callout"><strong>真实价值</strong>来自真实任务。</p><figure data-asset-id="{ASSET_ID}"><img src="/api/v1/assets/{ASSET_ID}/content"></figure></article>',
                "checks": [],
                "policy": {"scope": "WECHAT_LAYOUT_DESIGN", "provider": "BAILIAN_CLI", "connectionId": None, "model": "qwen-plus", "promptVersion": "wechat-layout-design:1"},
            })
        if path == f"/api/v1/content-drafts/{DRAFT_ID}/complete" and method == "POST":
            assert request.post_data_json == {"revision": state["current_revision"]}
            state["completed"] += 1
            ready = draft("READY")
            return respond(route, {"draft": ready, "version": {"id": "version-ready", "workspaceId": "workspace-1", "draftId": DRAFT_ID, "platform": "WECHAT", "versionNumber": 1, "title": ready["title"], "body": ready["body"], "visualPlan": {}, "renderedHtml": preview_html("清爽阅读"), "layoutTemplateVersionId": ready["layoutTemplateVersionId"], "sourceDraftVersionId": None, "generationRunId": None, "assets": ready["assets"], "createdAt": NOW}})
        if path in ("/api/v1/intelligence/sources", "/api/v1/intelligence/items"):
            return respond(route, [])
        state["unexpected"].append(f"{method} {path}")
        return respond(route, {"error": {"message": f"unhandled {method} {path}"}}, status=418)

    page.route("**/api/v1/**", handle_api)
    page.goto(f"{BASE_URL}/?view=create&project={PROJECT_ID}&stage=layout&platform=WECHAT")
    page.wait_for_load_state("networkidle")
    try:
        page.locator(".wechat-layout-workspace").wait_for(timeout=8_000)
    except Exception:
        page.screenshot(path=ARTIFACTS / "wechat-layout-diagnostic.png", full_page=True)
        raise AssertionError({"url": page.url, "text": page.locator("body").inner_text()[:2000], "unexpected": state["unexpected"], "console": state["console_errors"]})
    page.locator(".wechat-template-card").first.wait_for()
    assert page.locator(".wechat-template-card").count() == 6
    assert state["asset_reads"] == 1, f"preview image was loaded {state['asset_reads']} times"
    assert state["unauthenticated_asset_reads"] == 0, f"preview image was requested without workspace auth {state['unauthenticated_asset_reads']} times"
    mini_preview_box = page.locator(".wechat-template-mini-preview").first.bounding_box()
    mini_frame_box = page.locator(".wechat-template-mini-preview iframe").first.bounding_box()
    assert mini_preview_box and mini_frame_box and visible_ratio(mini_preview_box, mini_frame_box) > 0.95, "template preview was positioned outside its card"
    mini_frame = page.locator(".wechat-template-mini-preview iframe").first.content_frame
    assert mini_frame.locator("img").count() == 0, "template thumbnail decoded a full draft image"
    thumbnail_fingerprints = []
    mini_frames = page.locator(".wechat-template-mini-preview iframe")
    for index in range(mini_frames.count()):
        frame = mini_frames.nth(index).content_frame
        frame.locator("[data-layout-thumbnail]").wait_for()
        thumbnail_fingerprints.append(frame.locator("[data-layout-thumbnail]").evaluate("""node => {
            const style = getComputedStyle(node);
            const titleNode = node.querySelector("h1") || node.querySelector("header");
            const headingNode = node.querySelector("h2");
            const quote = getComputedStyle(node.querySelector("blockquote"));
            const image = getComputedStyle(node.querySelector("figure"));
            const dividerNode = node.querySelector("hr") || node.querySelector("[style*='继续阅读']") || node.querySelector("[style*='•••']");
            const title = getComputedStyle(titleNode);
            const heading = getComputedStyle(headingNode);
            const divider = dividerNode ? getComputedStyle(dividerNode) : {};
            return JSON.stringify({
                html: node.innerHTML.replace(/width:\\s*\\d+%/g, "width:x"),
                background: style.backgroundColor,
                title: title.color + title.backgroundColor + title.borderBottomColor,
                heading: heading.borderLeftColor + heading.borderBottomColor + heading.backgroundColor,
                quote: quote.backgroundColor,
                imageRadius: image.borderRadius,
                divider: String(divider.borderTopColor ?? "") + String(divider.borderTopWidth ?? "")
            });
        }"""))
    assert len(set(thumbnail_fingerprints)) >= 4, "system template thumbnails did not expose distinct layout styles"
    assert page.locator(".wechat-layout-preview-frame").count() == 1
    frame = page.locator(".wechat-layout-preview-frame").content_frame
    frame.locator("img").wait_for()
    image_src = frame.locator("img").get_attribute("src")
    assert image_src and image_src.startswith("blob:"), f"preview image did not use the authenticated Blob: {image_src}"
    assert frame.locator("img").evaluate("image => image.complete && image.naturalWidth > 0"), "preview image did not render"
    assert frame.locator("body").inner_text().strip()
    page.get_by_role("button", name="精排当前模板", exact=True).click()
    designed_frame = page.locator(".wechat-layout-preview-frame").content_frame
    designed_frame.locator("[data-layout-design-block]").wait_for()
    assert state["layout_designs"] == 1
    page.get_by_text("实际策略：公众号智能精排（WECHAT_LAYOUT_DESIGN） · BAILIAN_CLI / qwen-plus").wait_for()
    page.locator(".wechat-template-card .wechat-template-select").nth(1).click()
    other_frame = page.locator(".wechat-layout-preview-frame").content_frame
    other_frame.locator("h1").wait_for()
    assert other_frame.locator("[data-layout-design-block]").count() == 0, "smart layout leaked into another template preview"
    page.locator(".wechat-template-card .wechat-template-select").first.click()
    designed_frame = page.locator(".wechat-layout-preview-frame").content_frame
    designed_frame.locator("[data-layout-design-block]").wait_for()
    assert page.locator("pre").count() == 0
    assert_no_overflow(page, "desktop")
    page.screenshot(path=ARTIFACTS / "wechat-layout-desktop.png", full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(150)
    assert_no_overflow(page, "mobile")
    footer_box = page.locator(".delivery-workspace-footer").bounding_box()
    first_card_box = page.locator(".wechat-template-card").first.bounding_box()
    assert footer_box and first_card_box and not rectangles_overlap(footer_box, first_card_box), "mobile action bar obscured a template card"
    page.locator(".wechat-layout-preview").scroll_into_view_if_needed()
    page.wait_for_timeout(100)
    assert frame.locator("img").evaluate("image => image.complete && image.naturalWidth > 0"), "mobile preview image did not render"
    page.screenshot(path=ARTIFACTS / "wechat-layout-mobile.png", full_page=True)

    page.get_by_role("button", name="保存公众号草稿", exact=True).click()
    page.wait_for_timeout(100)
    assert state["completed"] == 1
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
