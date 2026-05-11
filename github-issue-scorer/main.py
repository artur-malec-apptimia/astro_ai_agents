"""
GitHub Issue Scorer — Astropods messaging server.

Send a message with a GitHub repository, e.g.:
    pallets/flask
    score anthropics/anthropic-sdk-python 10

Environment variables (injected by Astropods):
    OPENAI_API_KEY  — required
    GITHUB_TOKEN    — optional, raises rate limit from 60 to 5000 req/h
"""

import os
import re
from enum import Enum
from typing import Optional

from dotenv import load_dotenv
from github import Github
from github.Issue import Issue
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph, MessagesState
from pydantic import BaseModel, Field
from astropods_adapter_langchain import LangChainAdapter, serve

load_dotenv()


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class Priority(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class IssuePriority(BaseModel):
    priority: Priority = Field(description="Assigned priority: high, medium, or low")
    reason: str = Field(description="One-sentence justification for the priority")


class ScoredIssue(BaseModel):
    number: int
    title: str
    url: str
    state: str
    priority: Priority
    reason: str
    body_preview: Optional[str]


# ---------------------------------------------------------------------------
# Priority ordering for sorting
# ---------------------------------------------------------------------------

_PRIORITY_ORDER = {Priority.HIGH: 0, Priority.MEDIUM: 1, Priority.LOW: 2}


# ---------------------------------------------------------------------------
# GitHub helper
# ---------------------------------------------------------------------------

def fetch_issues(repo_name: str, max_issues: int) -> list[Issue]:
    token = os.getenv("GITHUB_TOKEN")
    g = Github(token)
    repo = g.get_repo(repo_name)
    issues = []
    for issue in repo.get_issues(state="open"):
        if issue.pull_request:   # skip PRs — GitHub returns them as issues
            continue
        issues.append(issue)
        if len(issues) >= max_issues:
            break
    return issues


# ---------------------------------------------------------------------------
# LangChain chain
# ---------------------------------------------------------------------------

def build_chain() -> tuple:
    """Return (chain, parser) ready to invoke."""
    parser = PydanticOutputParser(pydantic_object=IssuePriority)

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                (
                    "You are a software project manager. "
                    "Analyse the GitHub issue below and assign a priority.\n\n"
                    "Rules:\n"
                    "- HIGH   — security vulnerability, data loss, crash, or blocker\n"
                    "- MEDIUM — significant bug, degraded UX, or important feature\n"
                    "- LOW    — minor bug, cosmetic issue, nice-to-have, or question\n\n"
                    "{format_instructions}"
                ),
            ),
            (
                "human",
                "Title: {title}\n\nDescription:\n{body}",
            ),
        ]
    ).partial(format_instructions=parser.get_format_instructions())

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    chain = prompt | llm | parser
    return chain, parser


# ---------------------------------------------------------------------------
# Scoring logic
# ---------------------------------------------------------------------------

def score_issues(repo_name: str, max_issues: int) -> list[ScoredIssue]:
    issues = fetch_issues(repo_name, max_issues)
    chain, _ = build_chain()
    scored: list[ScoredIssue] = []

    for issue in issues:
        body = (issue.body or "").strip()
        body_preview = body[:300] + ("..." if len(body) > 300 else "")

        result: IssuePriority = chain.invoke(
            {"title": issue.title, "body": body or "(no description provided)"}
        )

        scored.append(
            ScoredIssue(
                number=issue.number,
                title=issue.title,
                url=issue.html_url,
                state=issue.state,
                priority=result.priority,
                reason=result.reason,
                body_preview=body_preview or None,
            )
        )

    scored.sort(key=lambda s: _PRIORITY_ORDER[s.priority])
    return scored


def format_report(scored: list[ScoredIssue]) -> str:
    lines = ["=" * 70, "PRIORITIZED ISSUE LIST", "=" * 70]

    current_priority = None
    for s in scored:
        if s.priority != current_priority:
            current_priority = s.priority
            lines.append(f"\n--- {s.priority.upper()} PRIORITY ---")
        lines.append(f"\n  #{s.number}  {s.title}")
        lines.append(f"  URL   : {s.url}")
        lines.append(f"  Reason: {s.reason}")
        if s.body_preview:
            lines.append(f"  Body  : {s.body_preview}")

    lines.append("\n" + "=" * 70)
    totals = {p: sum(1 for s in scored if s.priority == p) for p in Priority}
    lines.append(
        f"Total: {len(scored)} issues — "
        f"high: {totals[Priority.HIGH]}, "
        f"medium: {totals[Priority.MEDIUM]}, "
        f"low: {totals[Priority.LOW]}"
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LangGraph node
# ---------------------------------------------------------------------------

def scoring_node(state: MessagesState) -> dict:
    text = state["messages"][-1].content.strip()

    # Extract owner/repo (e.g. "pallets/flask")
    repo_match = re.search(r'([\w.-]+/[\w.-]+)', text)
    if not repo_match:
        return {"messages": [AIMessage(
            content="Please provide a GitHub repository in owner/repo format, e.g. `pallets/flask`."
        )]}

    repo_name = repo_match.group(1)

    # Extract optional issue count (first standalone number that isn't part of the repo)
    remainder = text.replace(repo_name, "")
    num_match = re.search(r'\b(\d+)\b', remainder)
    max_issues = int(num_match.group(1)) if num_match else 20

    try:
        scored = score_issues(repo_name, max_issues)
        if not scored:
            reply = f"No open issues found in `{repo_name}`."
        else:
            reply = f"Fetched and scored {len(scored)} issue(s) from `{repo_name}`.\n\n" + format_report(scored)
    except Exception as exc:
        reply = f"Error scoring `{repo_name}`: {exc}"

    return {"messages": [AIMessage(content=reply)]}


# ---------------------------------------------------------------------------
# LangGraph agent + Astropods adapter
# ---------------------------------------------------------------------------

_graph = StateGraph(MessagesState)
_graph.add_node("scorer", scoring_node)
_graph.add_edge(START, "scorer")
_graph.add_edge("scorer", END)
agent = _graph.compile()

adapter = LangChainAdapter(agent, name="github-issue-scorer")

if __name__ == "__main__":
    serve(adapter)
