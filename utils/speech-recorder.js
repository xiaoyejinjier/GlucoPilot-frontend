// RecorderManager是全局单例；取消后保留占用直到原生stop/error，避免旧回调落入新录音。
let manager, active

function removeAudio(path) {
  if (!path) return
  try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }) } catch (_) {}
}

function getManager() {
  if (manager) return manager
  if (!wx.getRecorderManager) throw new Error('当前微信版本不支持录音，请升级微信后重试')
  manager = wx.getRecorderManager()
  manager.onStart(() => {
    const session = active
    if (!session) return
    session.started = true
    if (session.stopping) manager.stop()
    else session.handlers.onStart()
  })
  manager.onStop(result => {
    const session = active
    active = null
    if (!session || session.cancelled) { removeAudio(result.tempFilePath); return }
    session.handlers.onStop(result)
  })
  manager.onError(() => {
    const session = active
    active = null
    if (session && !session.cancelled) session.handlers.onError(new Error('录音失败，请检查麦克风权限后重试'))
  })
  if (manager.onInterruptionBegin) manager.onInterruptionBegin(() => {
    const session = active
    if (!session || session.cancelled) return
    session.cancelled = true
    const wasStopping = session.stopping
    session.stopping = true
    session.handlers.onError(new Error('录音被中断，请重新录制'))
    if (session.started && !wasStopping) manager.stop()
  })
  return manager
}

function startSpeechRecording(handlers) {
  const recorder = getManager()
  if (active) throw new Error('上一段录音正在结束，请稍候再试')
  const session = { handlers, started: false, stopping: false, cancelled: false }
  active = session
  try {
    recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' })
  } catch (error) { active = null; throw new Error('无法开始录音，请稍后重试') }
  return {
    stop() {
      if (active !== session || session.stopping) return
      session.stopping = true
      if (session.started) recorder.stop()
    },
    cancel() {
      if (active !== session) return
      const wasStopping = session.stopping
      session.cancelled = true
      session.stopping = true
      if (session.started && !wasStopping) recorder.stop()
    }
  }
}

module.exports = { startSpeechRecording, removeAudio }
