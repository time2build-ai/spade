import pytest
from fastapi.testclient import TestClient
from tui_pilot import server

MENU = """\
Pick one
❯ 1. Alpha
  2. Beta
  3. Gamma
Enter to select · ↑/↓ to navigate
"""

class _FakeSess:
    def __init__(self): self.keys = []; self.cmd = "cat"; self.cwd = None
    def capture(self, history=False): return MENU
    def send_key(self, k): self.keys.append(k)
    def is_alive(self): return True

class _FakeCtrl:
    def __init__(self): self.session = _FakeSess()

@pytest.fixture()
def client_with_fake(monkeypatch):
    ctrl = _FakeCtrl()
    server._sessions["fake-1"] = ctrl
    server._meta["fake-1"] = {"id": "fake-1", "name": "fake"}
    server._locks["fake-1"] = __import__("threading").Lock()
    yield TestClient(server.app), ctrl
    server._sessions.pop("fake-1", None); server._meta.pop("fake-1", None)
    server._locks.pop("fake-1", None); server._pollers.pop("fake-1", None)

def test_get_menu_returns_parsed_menu(client_with_fake):
    client, _ = client_with_fake
    m = client.get("/sessions/fake-1/menu").json()["menu"]
    assert m["selected"] == 1 and [o["label"] for o in m["options"]] == ["Alpha","Beta","Gamma"]

def test_get_menu_null_when_no_menu(client_with_fake, monkeypatch):
    client, ctrl = client_with_fake
    ctrl.session.capture = lambda history=False: "no menu here\n❯ \n"
    assert client.get("/sessions/fake-1/menu").json()["menu"] is None

def test_select_option_sends_down_then_enter(client_with_fake):
    client, ctrl = client_with_fake
    r = client.post("/sessions/fake-1/menu", json={"index": 3})
    assert r.status_code == 200 and r.json()["ok"] is True
    # cursor at 1 → option 3 = two Downs, then Enter
    assert ctrl.session.keys == ["Down", "Down", "Enter"]

def test_select_option_up_when_target_above(client_with_fake):
    client, ctrl = client_with_fake
    ctrl.session.capture = lambda history=False: MENU.replace("❯ 1. Alpha","  1. Alpha").replace("  3. Gamma","❯ 3. Gamma")
    client.post("/sessions/fake-1/menu", json={"index": 1})
    assert ctrl.session.keys == ["Up", "Up", "Enter"]

def test_select_same_option_just_enter(client_with_fake):
    client, ctrl = client_with_fake
    client.post("/sessions/fake-1/menu", json={"index": 1})
    assert ctrl.session.keys == ["Enter"]

def test_select_invalid_option_is_400(client_with_fake):
    client, _ = client_with_fake
    assert client.post("/sessions/fake-1/menu", json={"index": 9}).status_code == 400

def test_select_when_no_menu_is_409(client_with_fake):
    client, ctrl = client_with_fake
    ctrl.session.capture = lambda history=False: "no menu\n"
    assert client.post("/sessions/fake-1/menu", json={"index": 1}).status_code == 409

def test_info_has_menu_flag(client_with_fake):
    client, _ = client_with_fake
    info = client.get("/sessions/fake-1").json()
    assert info["has_menu"] is True
