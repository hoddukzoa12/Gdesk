import type { Migration } from '../db/migrations'

/**
 * GitHub 에서 받아온 정보의 캐시 테이블. 모두 `cache_` 로 시작하며 로그아웃·계정 변경 때
 * clearCache() 가 비운다(고정·연결·설정은 core 테이블이라 건드리지 않는다).
 * - 저장소 기본 키는 GitHub 숫자 저장소 ID. 이름이 바뀌어도 같은 행을 갱신한다.
 * - PR·이슈 기본 키는 GraphQL 노드 ID. 목록 소속은 scope 표로 따로 둔다
 *   (`mine`, `review_requested`, `assigned`, `repo:<저장소 ID>`).
 * - cache_list_meta: 목록별 전체 개수(GitHub totalCount·issueCount)와 완전성. 상한에 잘린 목록이어도
 *   수치는 전체 개수로 보여 주고, 화면은 "GitHub 에서 더 보기"를 띄울 수 있다.
 * - cache_notification_done: 완료(done)한 알림 스레드와 그때의 갱신 시각. 새 활동 전에는 다시 보이지 않게 한다.
 */
export const migration: Migration = {
  id: '0100_cache',
  up(db) {
    db.exec(`
      CREATE TABLE cache_repositories (
        id INTEGER PRIMARY KEY,
        node_id TEXT,
        owner TEXT NOT NULL,
        owner_type TEXT NOT NULL DEFAULT 'User',
        owner_avatar_url TEXT,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL,
        url TEXT NOT NULL,
        private INTEGER NOT NULL DEFAULT 0,
        fork INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        homepage_url TEXT,
        primary_language TEXT,
        primary_language_color TEXT,
        default_branch TEXT,
        license TEXT,
        stargazer_count INTEGER NOT NULL DEFAULT 0,
        fork_count INTEGER NOT NULL DEFAULT 0,
        open_pr_count INTEGER NOT NULL DEFAULT 0,
        open_issue_count INTEGER NOT NULL DEFAULT 0,
        pushed_at TEXT,
        updated_at TEXT,
        topics TEXT NOT NULL DEFAULT '[]',
        viewer_permission TEXT,
        is_mine INTEGER NOT NULL DEFAULT 0,
        viewer_has_starred INTEGER NOT NULL DEFAULT 0,
        starred_at TEXT,
        access_status TEXT NOT NULL DEFAULT 'available'
          CHECK (access_status IN ('available', 'unavailable')),
        synced_at INTEGER NOT NULL
      );
      CREATE INDEX cache_repositories_mine ON cache_repositories (is_mine, pushed_at);
      CREATE INDEX cache_repositories_starred ON cache_repositories (viewer_has_starred, starred_at);

      CREATE TABLE cache_pull_requests (
        id TEXT PRIMARY KEY,
        repo_id INTEGER NOT NULL,
        repo_full_name TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author_login TEXT NOT NULL,
        author_avatar_url TEXT,
        author_is_bot INTEGER NOT NULL DEFAULT 0,
        author_association TEXT,
        viewer_is_author INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL CHECK (state IN ('open', 'draft')),
        review_status TEXT NOT NULL,
        ci_status TEXT NOT NULL,
        comment_count INTEGER NOT NULL DEFAULT 0,
        has_write_response INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX cache_pull_requests_repo ON cache_pull_requests (repo_id);
      CREATE TABLE cache_pull_request_scopes (
        scope TEXT NOT NULL,
        pr_id TEXT NOT NULL,
        PRIMARY KEY (scope, pr_id)
      );
      CREATE INDEX cache_pull_request_scopes_pr ON cache_pull_request_scopes (pr_id);

      CREATE TABLE cache_issues (
        id TEXT PRIMARY KEY,
        repo_id INTEGER NOT NULL,
        repo_full_name TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author_login TEXT NOT NULL,
        author_avatar_url TEXT,
        author_is_bot INTEGER NOT NULL DEFAULT 0,
        author_association TEXT,
        viewer_is_author INTEGER NOT NULL DEFAULT 0,
        labels TEXT NOT NULL DEFAULT '[]',
        comment_count INTEGER NOT NULL DEFAULT 0,
        has_write_response INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX cache_issues_repo ON cache_issues (repo_id);
      CREATE TABLE cache_issue_scopes (
        scope TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        PRIMARY KEY (scope, issue_id)
      );
      CREATE INDEX cache_issue_scopes_issue ON cache_issue_scopes (issue_id);

      CREATE TABLE cache_notifications (
        thread_id TEXT PRIMARY KEY,
        unread INTEGER NOT NULL,
        reason TEXT NOT NULL,
        subject_title TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_url TEXT,
        url TEXT NOT NULL,
        repo_id INTEGER,
        repo_full_name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE cache_commits (
        repo_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        sha TEXT NOT NULL,
        message TEXT NOT NULL,
        author_login TEXT,
        author_avatar_url TEXT,
        author_is_bot INTEGER NOT NULL DEFAULT 0,
        author_name TEXT,
        committed_at TEXT,
        url TEXT NOT NULL,
        ci_status TEXT NOT NULL,
        PRIMARY KEY (repo_id, position)
      );

      CREATE TABLE cache_releases (
        repo_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        name TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        is_prerelease INTEGER NOT NULL DEFAULT 0,
        is_draft INTEGER NOT NULL DEFAULT 0,
        is_latest INTEGER NOT NULL DEFAULT 0,
        url TEXT NOT NULL,
        PRIMARY KEY (repo_id, position)
      );

      CREATE TABLE cache_languages (
        repo_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        bytes INTEGER NOT NULL,
        PRIMARY KEY (repo_id, name)
      );

      CREATE TABLE cache_contributors (
        repo_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        login TEXT NOT NULL,
        avatar_url TEXT,
        url TEXT,
        contributions INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo_id, position)
      );

      CREATE TABLE cache_stargazers (
        repo_id INTEGER NOT NULL,
        starred_at TEXT NOT NULL,
        login TEXT
      );
      CREATE INDEX cache_stargazers_repo ON cache_stargazers (repo_id, starred_at);

      CREATE TABLE cache_repo_details (
        repo_id INTEGER PRIMARY KEY,
        synced_at INTEGER NOT NULL,
        release_count INTEGER NOT NULL DEFAULT 0,
        latest_release TEXT,
        contributor_count INTEGER,
        stars_since TEXT,
        stars_truncated INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE cache_sync_state (
        scope TEXT PRIMARY KEY,
        last_synced_at INTEGER,
        etag TEXT,
        last_modified TEXT,
        poll_interval INTEGER
      );

      CREATE TABLE cache_notification_done (
        thread_id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE cache_list_meta (
        scope TEXT PRIMARY KEY,
        total_count INTEGER NOT NULL,
        complete INTEGER NOT NULL
      );

      CREATE TABLE cache_org_restrictions (
        org_key TEXT PRIMARY KEY,
        org_login TEXT,
        reason TEXT NOT NULL,
        message TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );
    `)
  }
}
