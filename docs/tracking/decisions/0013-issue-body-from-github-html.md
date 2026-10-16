# 0013. 이슈 본문은 GitHub가 만든 HTML을 정리해서 보인다

## 맥락

Issues 화면에 앱 안 상세 패널을 만들면서 이슈 본문·코멘트를 그려야 했다. GitHub 마크다운은 표준 마크다운에 더해 작업 목록, `#123`·`@사람`·커밋 SHA 자동 링크, 이모지 단축어, 저장소 문맥에 따른 상대 링크, 비공개 이미지 주소 등을 GitHub 서버가 처리한다. 화면은 격리돼 있고(Node 없음, CSP `script-src 'self'`) 남이 쓴 글을 보여 주므로 HTML 주입을 막아야 한다.

## 결정

- GraphQL로 본문·코멘트의 `bodyHTML`(GitHub가 렌더링한 HTML)을 받아 캐시에 그대로 둔다.
- 화면은 이 HTML을 이 용도 전용 DOMPurify 인스턴스로 정리한 뒤에만 DOM에 넣는다(스크립트·iframe·form·object·embed·style 요소, style·이벤트 속성, `javascript:`·`data:` 링크 제거, 작업 목록 체크박스 비활성화). 링크는 앱 창을 옮기지 않고 http(s)만 기본 브라우저로 연다.
- 코멘트·새 이슈 입력의 미리보기도 같은 방식으로 `POST /markdown`(gfm, 저장소 문맥) 결과를 정리해 보인다.

## 다른 선택지

- **원문 마크다운(`body`)을 받아 화면에서 렌더링(remark·markdown-it 등)**: 네트워크 없이 미리보기가 되지만, GitHub 전용 문법(자동 링크, 상대 링크, 이모지, 비공개 이미지 주소)을 따로 흉내 내야 하고 결과가 GitHub 웹과 어긋난다. 정리(sanitize)도 어차피 필요하다.
- **정리 없이 GitHub HTML을 믿고 넣기**: GitHub가 대부분을 걸러 주지만, 앱 창 안에서 링크 이동·폼·인라인 스타일 같은 앱 고유의 위험은 GitHub가 막아 주지 않는다. 공개 저장소 이슈는 누구나 쓸 수 있다.
- **이슈 본문은 GitHub 웹으로만 보기(1단계 방식)**: 안전하지만 앱 안 상세를 만드는 목적에 맞지 않는다.

## 결과

- 화면 모습이 GitHub 웹과 같다. 대신 미리보기는 GitHub 요청이 필요해 오프라인·한도 대기 중에는 되지 않는다.
- 캐시에 HTML이 남으므로, 비공개 저장소의 만료되는 이미지 주소는 시간이 지나면 깨진다. 화면은 깨진 이미지를 대체 문구로 바꾸고, 상세를 다시 받으면 새 주소가 온다.
- CSP `img-src`에 GitHub 이미지 호스트(`*.githubusercontent.com`, `github.githubassets.com`, `github.com`)를 더했다. `connect-src`는 그대로라 화면은 여전히 네트워크 요청을 할 수 없다.
- GitHub HTML을 보이는 새 화면은 반드시 같은 정리 함수(`sanitizeIssueHtml`)와 부품(`SafeHtml`)을 써야 한다. 기본 DOMPurify 인스턴스에 훅을 달면 다른 코드로 규칙이 새므로 전용 인스턴스를 유지한다.
- 작업 목록 체크박스는 보이기만 하고 앱에서 바꿀 수 없다.
