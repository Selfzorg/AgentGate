import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { fetchPolyfillScript } from "../apps/web-dashboard/lib/fetch-polyfill";

describe("web dashboard fetch resilience", () => {
  it("installs an XMLHttpRequest-backed fetch before dashboard client components load", async () => {
    const layoutSource = await readFile(join(process.cwd(), "apps/web-dashboard/app/layout.tsx"), "utf8");
    expect(layoutSource).toContain("agentgate-fetch-polyfill");
    expect(layoutSource).toContain("dangerouslySetInnerHTML");
    expect(layoutSource).not.toContain("next/script");
    expect(() => new Function(fetchPolyfillScript)).not.toThrow();
    expect(fetchPolyfillScript).not.toContain("split(/\\r?\\n/)");

    const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];

    class FakeXMLHttpRequest {
      status = 200;
      statusText = "OK";
      responseText = JSON.stringify({ approvals: [{ id: "appr_test" }] });
      responseURL = "";
      withCredentials = false;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private method = "GET";
      private url = "";
      private headers: Record<string, string> = {};

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
        this.responseURL = url;
      }

      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }

      getAllResponseHeaders() {
        return "content-type: application/json\r\nx-agentgate-test: yes\r\n";
      }

      abort() {}

      send(body: unknown) {
        calls.push({ method: this.method, url: this.url, headers: this.headers, body });
        this.onload?.();
      }
    }

    const window = { fetch: undefined as unknown, XMLHttpRequest: FakeXMLHttpRequest };
    const context = vm.createContext({
      window,
      XMLHttpRequest: FakeXMLHttpRequest,
      Promise,
      JSON,
      TypeError,
      DOMException
    });

    vm.runInContext(fetchPolyfillScript, context);

    expect(typeof window.fetch).toBe("function");
    const response = await (window.fetch as (url: string, init?: unknown) => Promise<Response>)(
      "http://localhost:4000/api/v1/approvals",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true })
      }
    );

    await expect(response.json()).resolves.toEqual({ approvals: [{ id: "appr_test" }] });
    expect(response.ok).toBe(true);
    expect(response.headers.get("x-agentgate-test")).toBe("yes");
    expect(calls).toEqual([
      {
        method: "POST",
        url: "http://localhost:4000/api/v1/approvals",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true })
      }
    ]);
  });

  it("routes AgentGate API calls through XHR even when a native fetch exists", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const nativeCalls: string[] = [];

    class FakeXMLHttpRequest {
      status = 200;
      statusText = "OK";
      responseText = JSON.stringify({ skill_run: { id: "run_test" } });
      responseURL = "";
      onload: (() => void) | null = null;

      private method = "GET";
      private url = "";

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
        this.responseURL = url;
      }

      setRequestHeader() {}

      getAllResponseHeaders() {
        return "content-type: application/json\n";
      }

      abort() {}

      send(body: unknown) {
        calls.push({ method: this.method, url: this.url, body });
        this.onload?.();
      }
    }

    const nativeFetch = (url: string) => {
      nativeCalls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ delegated: true }) });
    };
    const window = { fetch: nativeFetch as unknown, XMLHttpRequest: FakeXMLHttpRequest };
    const context = vm.createContext({
      window,
      XMLHttpRequest: FakeXMLHttpRequest,
      Promise,
      JSON,
      String,
      TypeError,
      DOMException
    });

    vm.runInContext(fetchPolyfillScript, context);

    expect(window.fetch).not.toBe(nativeFetch);
    await (window.fetch as (url: string, init?: { method?: string; body?: string }) => Promise<Response>)(
      "http://localhost:4000/api/v1/skill-runs/run_test",
      { method: "POST", body: "{}" }
    );
    await (window.fetch as (url: string) => Promise<Response>)("http://localhost:3011/_next/static/chunks/main-app.js");

    expect(calls).toEqual([
      {
        method: "POST",
        url: "http://localhost:4000/api/v1/skill-runs/run_test",
        body: "{}"
      }
    ]);
    expect(nativeCalls).toEqual(["http://localhost:3011/_next/static/chunks/main-app.js"]);
  });
});
