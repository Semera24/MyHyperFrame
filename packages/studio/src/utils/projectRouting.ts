const PROJECT_HASH_PREFIX = "#project/";

export interface ProjectHashRoute {
  projectId: string;
  params: URLSearchParams;
}

const WINDOWS_DRIVE_PREFIX = /^[a-z]:/i;

/** Project names are single path segments, including when received from a hash or server. */
export function isValidProjectId(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !WINDOWS_DRIVE_PREFIX.test(value) &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32)
  );
}

function decodeHashProjectId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeHashParams(
  params?: URLSearchParams | Record<string, string | null | undefined>,
): URLSearchParams {
  if (!params) return new URLSearchParams();
  if (params instanceof URLSearchParams) return params;

  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!key || value == null || value === "") continue;
    next.set(key, value);
  }
  return next;
}

export function encodeProjectId(projectId: string): string {
  if (!isValidProjectId(projectId)) throw new Error("Invalid project ID");
  return encodeURIComponent(projectId);
}

export function buildProjectHash(
  projectId: string,
  params?: URLSearchParams | Record<string, string | null | undefined>,
): string {
  const search = normalizeHashParams(params).toString();
  return `${PROJECT_HASH_PREFIX}${encodeProjectId(projectId)}${search ? `?${search}` : ""}`;
}

export function parseProjectHashRoute(hash?: string | null): ProjectHashRoute | null {
  if (!hash || !hash.startsWith(PROJECT_HASH_PREFIX)) return null;

  const route = hash.slice(PROJECT_HASH_PREFIX.length);
  const queryIndex = route.indexOf("?");
  const encodedProjectId = queryIndex >= 0 ? route.slice(0, queryIndex) : route;
  if (!encodedProjectId || encodedProjectId.includes("/")) return null;

  const projectId = decodeHashProjectId(encodedProjectId);
  if (!isValidProjectId(projectId)) return null;

  const rawParams = queryIndex >= 0 ? route.slice(queryIndex + 1) : "";
  return {
    projectId,
    params: new URLSearchParams(rawParams),
  };
}

export function parseProjectIdFromHash(hash: string): string | null {
  return parseProjectHashRoute(hash)?.projectId ?? null;
}

export function parseProjectIdFromSearch(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("project")?.trim() ?? "";
  if (!raw || raw.includes("/")) return null;
  const decoded = decodeHashProjectId(raw);
  return isValidProjectId(decoded) ? decoded : null;
}

/**
 * Resolves the canonical project ID from `location.hash` and `location.search`.
 * Hash route (`#project/<id>`) is canonical; if `?project=<id>` is present without a hash,
 * it is adopted and canonicalized into `#project/<id>` while stripping `?project=`.
 */
export function resolveUrlProjectId(
  location: Pick<Location, "search" | "hash"> = window.location,
): {
  projectId: string | null;
  hashProjectId: string | null;
  searchProjectId: string | null;
  hasConflict: boolean;
} {
  const hashProjectId = parseProjectIdFromHash(location.hash);
  const searchProjectId = parseProjectIdFromSearch(location.search);
  const hasConflict =
    hashProjectId !== null && searchProjectId !== null && hashProjectId !== searchProjectId;
  return {
    projectId: hashProjectId ?? searchProjectId,
    hashProjectId,
    searchProjectId,
    hasConflict,
  };
}

/**
 * Navigates cleanly to `projectId` using the canonical `#project/<id>` route
 * and strips any stale `?project=` query parameter.
 */
export function navigateToProject(projectId: string): void {
  if (typeof window === "undefined") return;
  const nextHash = buildProjectHash(projectId);
  const nextUrl = `${window.location.pathname}${nextHash}`;
  window.history.replaceState(null, "", nextUrl);
  window.dispatchEvent(new Event("hashchange"));
}

/**
 * Guard called before any file write or server file mutation to guarantee
 * that the URL (`search` and `hash`), selected project, and editing target agree.
 */
export function assertProjectUrlAgreement(
  expectedProjectId: string,
  location: Pick<Location, "search" | "hash"> | undefined = typeof window !== "undefined"
    ? window.location
    : undefined,
): void {
  if (!isValidProjectId(expectedProjectId)) {
    throw new Error(`Invalid target project ID: ${expectedProjectId}`);
  }
  if (!location) return;
  const { hashProjectId, searchProjectId, hasConflict } = resolveUrlProjectId(location);
  if (hasConflict) {
    throw new Error(
      `URL project mismatch: query (?project=${searchProjectId}) conflicts with hash (#project/${hashProjectId}). Refusing to write to ${expectedProjectId}.`,
    );
  }
  const urlProjectId = hashProjectId ?? searchProjectId;
  if (urlProjectId && urlProjectId !== expectedProjectId) {
    throw new Error(
      `Active project mismatch: URL specifies "${urlProjectId}" but editor attempted to write to "${expectedProjectId}".`,
    );
  }
}

export function buildProjectApiPath(projectId: string, suffix = ""): string {
  const normalizedSuffix = suffix && !suffix.startsWith("/") ? `/${suffix}` : suffix;
  return `/api/projects/${encodeProjectId(projectId)}${normalizedSuffix}`;
}
