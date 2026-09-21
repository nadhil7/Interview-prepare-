const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchTextCappedFailure =
  | { type: "http_status"; status: number }
  | { type: "content_type_mismatch" }
  | { type: "too_large" }
  | { type: "network_error"; message: string };

export type FetchTextCappedResult =
  | { ok: true; res: Response; text: string }
  | { ok: false; reason: FetchTextCappedFailure };

export interface FetchTextCappedOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  redirect?: "follow" | "error" | "manual";
  /** if set, the response's content-type header must include this string or the fetch is rejected. */
  requireContentTypeIncludes?: string;
}

/**
 * every outbound fetch this project makes to a third party (a company
 * page, a search results page) should go through this, not a bare fetch
 * call, so the same timeout and byte cap apply everywhere. a size cap
 * checked only against the declared content length header can be lied
 * about or left out, so the body is read in chunks and cut off as soon
 * as it passes the cap, not just checked once up front.
 */
export async function fetchTextCapped(url: string, options: FetchTextCappedOptions = {}): Promise<FetchTextCappedResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: options.headers,
      redirect: options.redirect ?? "follow",
    });

    if (!res.ok) {
      return { ok: false, reason: { type: "http_status", status: res.status } };
    }

    if (options.requireContentTypeIncludes) {
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes(options.requireContentTypeIncludes)) {
        return { ok: false, reason: { type: "content_type_mismatch" } };
      }
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength && declaredLength > maxBytes) {
      return { ok: false, reason: { type: "too_large" } };
    }

    const text = await readBodyCapped(res, maxBytes);
    if (text === null) {
      return { ok: false, reason: { type: "too_large" } };
    }

    return { ok: true, res, text };
  } catch (err) {
    return { ok: false, reason: { type: "network_error", message: (err as Error).message } };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
