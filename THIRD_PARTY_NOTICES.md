# 외부 구성요소 라이선스

LingoPlay 자체 소스 코드와 에셋에는 루트의 [Unlicense](LICENSE)가 적용됩니다. 이 라이선스는 타사 코드의 기존 라이선스나 상표 권리를 변경하지 않습니다.

- **Electron** — MIT. [고지문](licenses/electron.txt), [공식 프로젝트](https://github.com/electron/electron).
- **ws** — MIT. [고지문](licenses/ws.txt), [공식 프로젝트](https://github.com/websockets/ws).
- **Chromium, Node.js 및 Electron에 포함된 기타 구성요소** — 각 구성요소의 라이선스가 적용됩니다. 배포 ZIP의 `LICENSE.electron.txt` 및 `LICENSES.chromium.html`에 포함된 전체 고지를 유지하세요.
- 빌드 도구와 개발 의존성은 각 npm 패키지에 포함된 라이선스를 따릅니다. 고정된 버전은 `package-lock.json`에 기록되어 있습니다.

OpenAI API, Discord, 가상 오디오 드라이버는 별도 서비스 또는 제품입니다. 해당 서비스나 드라이버의 이용 권한과 API 사용료는 이 프로젝트의 라이선스에 포함되지 않습니다. LingoPlay는 OpenAI 또는 Discord의 공식 제품이 아닙니다.
