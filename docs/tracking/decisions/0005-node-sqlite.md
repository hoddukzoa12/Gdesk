# 0005. 네이티브 SQLite 드라이버 대신 `node:sqlite`

## 맥락

캐시·고정·연결·설정을 로컬 SQLite에 둔다. 흔한 선택인 `better-sqlite3` 같은 네이티브 모듈은 Electron의 Node ABI에 맞춰 OS·CPU별로 다시 빌드해야 한다. 애플 실리콘 한 대에서 arm64·x64 맥 앱을 함께 만들고, 윈도우·리눅스는 CI에서 만든다. 단위 테스트는 Electron이 아니라 일반 Node에서 돈다.

## 결정

Node 내장 `node:sqlite`(`DatabaseSync`)를 쓴다. Electron 44(Node 24)에 들어 있고, 단위 테스트는 Node 22.13 이상에서 같은 API로 돈다. 포장에서 네이티브 재빌드를 끈다(`npmRebuild: false`).

## 다른 선택지

- **better-sqlite3**: 성숙하지만 Electron용 재빌드, CPU 교차 빌드, 단위 테스트(Node ABI)와 앱(Electron ABI)의 이중 빌드가 필요하다.
- **sql.js(WASM)**: 파일을 통째로 메모리에 올렸다 쓰는 방식이라 WAL·부분 쓰기가 없고 큰 캐시에서 느리다.
- **JSON 파일**: 목록 소속·완료 기록·검색 같은 질의와 트랜잭션을 직접 만들어야 한다.

## 결과

- 네이티브 모듈이 하나도 없어 패키징이 단순하다. 앞으로도 네이티브 모듈을 넣으면 이 장점이 사라진다.
- 개발·CI의 Node가 22.13 이상이어야 한다. 더 낮으면 단위 테스트가 `node:sqlite`를 불러오지 못한다.
- 동기 API라 큰 질의는 메인 프로세스를 잠깐 막는다. 질의는 작은 단위로 하고, 쓰기는 트랜잭션으로 묶는다.
- SQLite 확장(FTS 모듈 로드 등)이나 드라이버 전용 기능은 쓸 수 없다. 로컬 검색은 `LIKE`로 한다.
- Electron을 올리면 그 안의 Node `node:sqlite` 동작이 바뀔 수 있어 DB 테스트를 앱에서도 확인해야 한다.
