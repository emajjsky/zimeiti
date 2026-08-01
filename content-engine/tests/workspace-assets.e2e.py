import base64
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("CONTENT_ENGINE_E2E_URL", "http://127.0.0.1:5173")
NOW = "2026-08-01T08:00:00.000Z"
WORKSPACE_A = "11111111-1111-4111-8111-111111111111"
WORKSPACE_B = "22222222-2222-4222-8222-222222222222"
ASSET_ID = "33333333-3333-4333-8333-333333333333"
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


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


def workspace_profile():
    return {
        "primaryTopics": ["AI 工具"],
        "accountPositioning": "实用内容",
        "targetAudience": "内容创作者",
        "enabledPlatforms": ["WECHAT", "XIAOHONGSHU", "ZHIHU", "WEIBO"],
        "setupCompleted": True,
    }


def project(project_id, title):
    return {
        "id": project_id,
        "title": title,
        "originType": "MANUAL",
        "stage": "PLANNING",
        "status": "BRIEF",
        "planning": {
            "title": title,
            "category": "测试",
            "angle": "验证素材复用",
            "objective": "验证空间素材关系",
            "targetAudience": "创作者",
            "coreMessage": "一个素材可以安全复用",
            "targetPlatforms": ["WECHAT"],
            "timing": "EVERGREEN",
            "sourceRequirements": "",
            "constraints": "",
        },
        "planningVersion": 1,
        "coreViewpoint": "一个素材可以安全复用",
        "factChecks": [],
        "versions": [],
        "sourceSnapshot": {},
        "createdAt": NOW,
        "updatedAt": NOW,
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        **({"executable_path": chrome_path()} if chrome_path() else {}),
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    sample_file = Path(tempfile.gettempdir()) / "content-engine-workspace-asset.png"
    sample_file.write_bytes(PNG_BYTES)

    state = {
        "session": {
            "accessToken": "mock-access-token",
            "user": {"id": "user-1", "email": "creator@example.com", "display_name": "验收用户"},
            "workspaces": [{"id": WORKSPACE_A, "name": "个人账号", "role": "OWNER", "status": "ACTIVE"}],
            "activeWorkspaceId": WORKSPACE_A,
        },
        "assets": {WORKSPACE_A: [], WORKSPACE_B: []},
        "projects": {
            WORKSPACE_A: [project("project-a", "项目 A"), project("project-b", "项目 B")],
            WORKSPACE_B: [],
        },
        "links": set(),
        "requests": [],
        "unexpected": [],
        "console_errors": [],
    }
    page.on("console", lambda message: state["console_errors"].append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: state["console_errors"].append(str(error)))

    def session_payload():
        return {
            "accessToken": state["session"]["accessToken"],
            "user": state["session"]["user"],
            "workspaces": state["session"]["workspaces"],
            "activeWorkspaceId": state["session"]["activeWorkspaceId"],
        }

    def asset_payload():
        project_count = sum(1 for project_id, asset_id in state["links"] if asset_id == ASSET_ID)
        return {
            "id": ASSET_ID,
            "kind": "IMAGE",
            "origin": "UPLOAD",
            "status": "ACTIVE",
            "title": sample_file.name,
            "originalFilename": sample_file.name,
            "mimeType": "image/png",
            "sizeBytes": len(PNG_BYTES),
            "sha256": "a" * 64,
            "sourceUrl": None,
            "sourceNote": "端到端验收素材",
            "copyrightStatus": "OWNED",
            "projectCount": project_count,
            "createdAt": NOW,
            "updatedAt": NOW,
        }

    def handle_api(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        method = request.method
        state["requests"].append((method, path, request.headers.get("x-workspace-id")))

        if path == "/api/v1/auth/register" and method == "POST":
            return respond(route, session_payload(), 201)
        if path == "/api/v1/auth/me" and method == "GET":
            return respond(route, session_payload())
        if path == "/api/v1/workspaces" and method == "GET":
            return respond(route, session_payload())
        if path == "/api/v1/workspaces" and method == "POST":
            payload = json.loads(request.post_data or "{}")
            workspace = {"id": WORKSPACE_B, "name": payload["name"], "role": "OWNER", "status": "ACTIVE"}
            state["session"]["workspaces"].append(workspace)
            state["session"]["activeWorkspaceId"] = WORKSPACE_B
            return respond(route, session_payload(), 201)
        if path == "/api/v1/me/active-workspace" and method == "PUT":
            payload = json.loads(request.post_data or "{}")
            state["session"]["activeWorkspaceId"] = payload["workspaceId"]
            return respond(route, session_payload())
        if path.endswith("/deletion-impact") and method == "GET":
            workspace_id = path.split("/")[-2]
            return respond(route, {
                "projects": len(state["projects"].get(workspace_id, [])),
                "assets": len(state["assets"].get(workspace_id, [])),
                "channelAccounts": 0,
                "publications": 0,
                "metricSnapshots": 0,
                "retrospectives": 0,
            })
        if path.startswith("/api/v1/workspaces/") and method == "DELETE":
            workspace_id = path.rsplit("/", 1)[-1]
            state["session"]["workspaces"] = [item for item in state["session"]["workspaces"] if item["id"] != workspace_id]
            if state["session"]["activeWorkspaceId"] == workspace_id:
                state["session"]["activeWorkspaceId"] = None
            return respond(route, {**session_payload(), "deletionJobId": "delete-1", "queueJobId": "queue-1", "queued": True}, 202)

        workspace_id = request.headers.get("x-workspace-id")
        assert workspace_id == state["session"]["activeWorkspaceId"], f"{method} {path} 使用了错误工作空间: {workspace_id}"
        if path == "/api/v1/workspace/state" and method == "GET":
            return respond(route, {
                "state": {
                    "workspace": workspace_profile(),
                    "feishuTemplate": {"name": "内容库", "topicStorage": "ONE_TABLE", "includeSchedule": True, "includeReview": False, "status": "DRAFT"},
                    "sources": [],
                    "intelligence": [],
                    "topics": [],
                    "projects": state["projects"].get(workspace_id, []),
                },
                "revision": 1,
                "updatedAt": NOW,
            })
        if path in ("/api/v1/intelligence/sources", "/api/v1/intelligence/items") and method == "GET":
            return respond(route, [])
        if path == "/api/v1/assets" and method == "GET":
            assets = [asset_payload()] if state["assets"].get(workspace_id) else []
            return respond(route, {"assets": assets})
        if path == "/api/v1/assets" and method == "POST":
            state["assets"][workspace_id] = [ASSET_ID]
            return respond(route, {"created": True, "asset": asset_payload()}, 201)
        if path == f"/api/v1/assets/{ASSET_ID}/content" and method == "GET":
            assert ASSET_ID in state["assets"].get(workspace_id, []), "跨空间读取了素材内容"
            return route.fulfill(status=200, content_type="image/png", body=PNG_BYTES)
        if path in (f"/api/v1/projects/project-a/assets/{ASSET_ID}", f"/api/v1/projects/project-b/assets/{ASSET_ID}"):
            project_id = path.split("/")[-3]
            if method == "POST":
                state["links"].add((project_id, ASSET_ID))
                return respond(route, {**asset_payload(), "linkId": f"link-{project_id}", "projectId": project_id, "role": "VISUAL", "scope": "IMAGING", "platforms": ["WECHAT"], "notes": ""}, 201)
            if method == "DELETE":
                state["links"].discard((project_id, ASSET_ID))
                return route.fulfill(status=204, body="")
        state["unexpected"].append(f"{method} {path}")
        return respond(route, {"error": {"message": f"未配置接口: {method} {path}"}}, 418)

    page.route("**/api/v1/**", handle_api)
    page.goto(f"{BASE_URL}/?view=settings&settings=workspace")
    page.wait_for_load_state("networkidle")

    page.locator(".web-auth .text-button").click()
    register_inputs = page.locator(".web-auth form input")
    register_inputs.nth(0).fill("验收用户")
    register_inputs.nth(1).fill("个人账号")
    register_inputs.nth(2).fill("creator@example.com")
    register_inputs.nth(3).fill("secure-pass-123")
    page.locator(".web-auth form button[type=submit]").click()
    page.locator(".workspace-management-settings").wait_for()

    page.locator(".workspace-create-form input").fill("客户 B")
    page.locator(".workspace-create-form button[type=submit]").click()
    page.locator(".workspace-management-settings").wait_for()
    assert state["session"]["activeWorkspaceId"] == WORKSPACE_B
    assert page.locator(".workspace-management-list article").count() == 2

    page.locator(".workspace-management-list article:not(.current) .workspace-management-actions .button").click()
    page.locator(".workspace-management-settings").wait_for()
    assert state["session"]["activeWorkspaceId"] == WORKSPACE_A

    page.locator(".nav-item").nth(5).click()
    page.locator(".asset-library").wait_for()
    page.locator(".asset-library input[type=file]").set_input_files(str(sample_file))
    page.locator(".asset-card").wait_for()
    page.locator(".asset-card-preview").click()
    page.locator(".asset-preview-dialog .asset-preview-image").wait_for()
    page.locator(".asset-preview-dialog .icon-button").click()

    for project_id in ("project-a", "project-b"):
        result = page.evaluate(
            """async ({ projectId, assetId, workspaceId }) => {
              const response = await fetch(`/api/v1/projects/${projectId}/assets/${assetId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId },
                body: JSON.stringify({ role: 'VISUAL', scope: 'IMAGING', title: '验收素材', notes: '', platforms: ['WECHAT'] }),
              });
              return response.status;
            }""",
            {"projectId": project_id, "assetId": ASSET_ID, "workspaceId": WORKSPACE_A},
        )
        assert result == 201
    page.reload()
    page.locator(".asset-card").wait_for()
    assert page.locator(".asset-card .danger-icon").is_disabled()

    unlink_status = page.evaluate(
        """async ({ assetId, workspaceId }) => (await fetch(`/api/v1/projects/project-a/assets/${assetId}`, {
          method: 'DELETE', headers: { 'X-Workspace-Id': workspaceId }
        })).status""",
        {"assetId": ASSET_ID, "workspaceId": WORKSPACE_A},
    )
    assert unlink_status == 204
    page.reload()
    page.locator(".asset-card-preview").click()
    page.locator(".asset-preview-dialog .asset-preview-image").wait_for()
    page.locator(".asset-preview-dialog .icon-button").click()

    page.locator(".nav-item").nth(6).click()
    page.locator(".workspace-management-settings").wait_for()
    page.locator(".workspace-management-list article:not(.current) .workspace-management-actions .button").click()
    page.locator(".workspace-management-settings").wait_for()
    assert state["session"]["activeWorkspaceId"] == WORKSPACE_B
    page.locator(".nav-item").nth(5).click()
    page.locator(".asset-library-empty").wait_for()

    page.reload()
    page.locator(".asset-library-empty").wait_for()
    stored_session = json.loads(page.evaluate("localStorage.getItem('content-engine-web-session-v1')"))
    assert stored_session["activeWorkspaceId"] == WORKSPACE_B

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(100)
    assert_no_overflow(page, "390px 素材库")
    page.locator(".mobile-menu-button").click()
    page.locator(".sidebar .nav-item").nth(6).click()
    page.locator(".workspace-management-settings").wait_for()
    assert_no_overflow(page, "390px 工作空间管理")

    page.locator(".workspace-management-list article.current .danger-text").click()
    page.locator(".workspace-delete-dialog").wait_for()
    assert page.locator(".workspace-delete-dialog .button.danger").is_disabled()
    page.locator(".workspace-delete-dialog input").fill("客户 B")
    assert not page.locator(".workspace-delete-dialog .button.danger").is_disabled()
    page.locator(".workspace-delete-dialog .button.danger").click()
    page.locator(".workspace-gate").wait_for()

    assert state["session"]["activeWorkspaceId"] is None
    assert len(state["session"]["workspaces"]) == 1
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
    sample_file.unlink(missing_ok=True)
