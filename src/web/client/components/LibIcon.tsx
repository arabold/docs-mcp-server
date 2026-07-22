/**
 * Library "avatar" matching the mockup's `.lib-ico`: a two-letter monogram
 * derived from the library name, upgraded to the site's real favicon when
 * one loads successfully. The monogram is the always-present fallback —
 * favicon loading is best-effort only (no favicon service/API dependency;
 * it just tries `https://{host}/favicon.ico` and silently keeps the
 * monogram on any error).
 */
import { useMemo, useState } from "react";

export interface LibIconProps {
  /** Library name, used to derive the two-letter monogram (e.g. "react" -> "Re"). */
  name: string;
  /** Source URL or hostname to try a favicon for. Omit to always show the monogram. */
  url?: string | null;
  /** Larger `.lib-ico.big` variant (library detail header). */
  big?: boolean;
  className?: string;
}

function monogramFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return (trimmed[0]?.toUpperCase() ?? "?") + (trimmed[1]?.toLowerCase() ?? "");
}

function hostFor(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

/**
 * @example <LibIcon name="react" url="https://react.dev/reference" />
 */
export function LibIcon({ name, url, big = false, className }: LibIconProps) {
  const host = useMemo(() => hostFor(url), [url]);
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");

  const showImage = host !== null && state !== "failed";
  const classes = [
    "lib-ico",
    big ? "big" : "",
    state === "loaded" ? "lib-ico--fav" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-host={host ?? undefined}>
      {showImage ? (
        <img
          src={`https://${host}/favicon.ico`}
          alt=""
          style={{ display: state === "loaded" ? "block" : "none" }}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      ) : null}
      {state !== "loaded" ? monogramFor(name) : null}
    </div>
  );
}
