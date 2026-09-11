window.captions.on(state => {
  document.querySelector('#screenText').textContent = state.screen;
  document.querySelector('#voiceText').textContent = state.voice;
  document.querySelector('#original').textContent = state.original;
  document.querySelector('#screen').hidden = !state.screen;
  document.querySelector('#voice').hidden = !state.voice;
  document.querySelector('#empty').hidden = Boolean(state.screen || state.voice);
  document.querySelector('main').style.fontSize = `${state.size}px`;
  document.body.classList.toggle('locked', state.locked);
  document.querySelector('#hint').textContent = state.locked ? '메인 앱의 잠금 해제로 이동할 수 있어요' : '이 막대를 드래그해서 이동';
});
document.querySelector('#lock').onclick = () => window.captions.control('lock');
document.querySelector('#hide').onclick = () => window.captions.control('hide');
