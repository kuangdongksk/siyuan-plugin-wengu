/**
 * 词发音（docs/wordbook-redesign §一）：系统 speechSynthesis（
 * Electron/Chromium 内置 TTS），en-US、语速 0.9——零依赖零费用离线可用；
 * 不可用环境静默跳过。音标文本已自带（service/WordPhonetics，
 * ECDICT 提取）；真人音频接词典 API 仍挂账（本机网络不通，
 * dictionaryapi.dev 不可达）。
 */
export function speakWord(text: string): void {
    if (typeof speechSynthesis === "undefined" || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    speechSynthesis.speak(u);
}
