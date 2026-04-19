#!/usr/bin/env node

/**
 * Fetch PR review comments from GitHub and produce a JSON data file
 * for the PR comments anywidget.
 *
 * Usage:
 *   node scripts/fetch-pr-comments.mjs --owner pollomarzo --repo 2025-pr-reviews-experience --pr 1
 *   node scripts/fetch-pr-comments.mjs --pr pollomarzo/2025-pr-reviews-experience#1
 *
 * Output (stdout): JSON with pr metadata, comments, and review comments.
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

let owner, repo, prNumber;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--owner" && args[i + 1]) owner = args[++i];
  else if (args[i] === "--repo" && args[i + 1]) repo = args[++i];
  else if (args[i] === "--pr" && args[i + 1]) {
    const val = args[++i];
    // Support --pr owner/repo#123 format
    const match = val.match(/^(.+)\/(.+)#(\d+)$/);
    if (match) {
      owner = match[1];
      repo = match[2];
      prNumber = parseInt(match[3], 10);
    } else {
      prNumber = parseInt(val, 10);
    }
  }
  else if (args[i] === "--out" && args[i + 1]) {
    // will be handled below
    i++;
  }
}

// Determine output file
const outIdx = args.indexOf("--out");
const outFile = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;

// Fallback: try to infer from git remote
if (!owner || !repo) {
  try {
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const m = remoteUrl.match(/[:/]([^/]+)\/([^/.]+)/);
    if (m) {
      if (!owner) owner = m[1];
      if (!repo) repo = m[2];
    }
  } catch {}
}

if (!owner || !repo || !prNumber) {
  console.error("Usage: node fetch-pr-comments.mjs --owner OWNER --repo REPO --pr NUMBER");
  console.error("   or: node fetch-pr-comments.mjs --pr owner/repo#123");
  console.error("   or: node fetch-pr-comments.mjs --pr 1  (infers owner/repo from git)");
  process.exit(1);
}

// ── GitHub API helpers ───────────────────────────────────────────────────────

function ghApi(endpoint) {
  try {
    const result = execSync(`gh api ${endpoint}`, { encoding: "utf-8" }).trim();
    return JSON.parse(result);
  } catch (err) {
    console.error(`Failed to fetch ${endpoint}: ${err.message}`);
    return null;
  }
}

function ghApiPaginated(endpoint) {
  let page = 1;
  let all = [];
  while (true) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const data = ghApi(`${endpoint}${separator}per_page=100&page=${page}`);
    if (!data || !Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
  }
  return all;
}

// ── Fetch data ───────────────────────────────────────────────────────────────

console.error(`Fetching PR data for ${owner}/${repo}#${prNumber}...`);

// PR metadata
const prData = ghApi(`repos/${owner}/${repo}/pulls/${prNumber}`);
if (!prData) {
  console.error("Could not fetch PR data. Make sure gh is authenticated.");
  process.exit(1);
}

// Review comments (inline, tied to specific lines)
const reviewComments = ghApiPaginated(
  `repos/${owner}/${repo}/pulls/${prNumber}/comments`
);

// PR-level reviews (general comments)
const reviews = ghApiPaginated(
  `repos/${owner}/${repo}/pulls/${prNumber}/reviews`
);

// PR issue comments (general discussion)
const issueComments = ghApiPaginated(
  `repos/${owner}/${repo}/issues/${prNumber}/comments`
);

// ── Build output ─────────────────────────────────────────────────────────────

const result = {
  pr: {
    title: prData.title,
    url: prData.html_url,
    number: prData.number,
    author: prData.user?.login,
    state: prData.state,
    head_sha: prData.head?.sha,
    head_ref: prData.head?.ref,
  },
  // Inline review comments (tied to specific lines/files)
  comments: reviewComments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line,
    original_line: c.original_line,
    side: c.side,
    author: c.user?.login,
    author_avatar: c.user?.avatar_url,
    body: c.body,
    diff_hunk: c.diff_hunk,
    in_reply_to_id: c.in_reply_to_id,
    commit_id: c.commit_id,
    created_at: c.created_at,
    url: c.html_url,
  })),
  // General review submissions
  reviews: reviews
    .filter((r) => r.body && r.body.trim())
    .map((r) => ({
      id: r.id,
      author: r.user?.login,
      author_avatar: r.user?.avatar_url,
      body: r.body,
      state: r.state,
      submitted_at: r.submitted_at,
      url: r.html_url,
    })),
  // Issue-level comments (conversation)
  issue_comments: issueComments.map((c) => ({
    id: c.id,
    author: c.user?.login,
    author_avatar: c.user?.avatar_url,
    body: c.body,
    created_at: c.created_at,
    url: c.html_url,
  })),
};

const json = JSON.stringify(result, null, 2);

if (outFile) {
  writeFileSync(outFile, json, "utf-8");
  console.error(`✓ Written to ${outFile}`);
} else {
  console.log(json);
}

console.error(
  `✓ Fetched ${reviewComments.length} inline comments, ${reviews.length} reviews, ${issueComments.length} issue comments`
);