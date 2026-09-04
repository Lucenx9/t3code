const HUNK_HEADER_PATTERN = /^@@(?:@)?\s/u;
const PATCH_METADATA_PATTERN =
  /^(?:diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch$)/u;

/** Text nodes rendered in Pierre's code column, without gutters or diff chrome. */
export function reviewDiffVisibleText(diff: string): string {
  const lines = diff.replace(/\r\n?/gu, "\n").split("\n");
  const hasHunk = lines.some((line) => HUNK_HEADER_PATTERN.test(line));
  let insideHunk = !hasHunk;
  const visible: string[] = [];

  for (const line of lines) {
    if (HUNK_HEADER_PATTERN.test(line)) {
      insideHunk = true;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      insideHunk = false;
      continue;
    }
    if (!insideHunk || line === "\\ No newline at end of file") continue;
    if (!hasHunk && PATCH_METADATA_PATTERN.test(line)) continue;
    visible.push(/^[- +]/u.test(line) ? line.slice(1) : line);
  }

  return visible.join("\n").trimEnd();
}
