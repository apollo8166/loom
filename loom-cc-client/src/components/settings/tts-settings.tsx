'use client'

import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Volume2, CheckCircle, Loader2 } from 'lucide-react'

/* ── Voice data (inlined from classroom constants) ── */
const TTS_ORDER = ['glm-tts', 'qwen-tts', 'minimax-tts', 'doubao-tts', 'browser-native-tts'] as const
type TtsTabId = (typeof TTS_ORDER)[number]

const TTS_LABELS: Record<TtsTabId, string> = {
  'glm-tts': 'GLM',
  'qwen-tts': '千问',
  'minimax-tts': 'MiniMax',
  'doubao-tts': '豆包',
  'browser-native-tts': '浏览器原生',
}

const TTS_PROVIDER_META: Record<TtsTabId, { defaultBaseUrl: string; requiresApiKey: boolean }> = {
  'glm-tts': { defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', requiresApiKey: true },
  'qwen-tts': { defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1', requiresApiKey: true },
  'minimax-tts': { defaultBaseUrl: 'https://api.minimaxi.com', requiresApiKey: true },
  'doubao-tts': { defaultBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts', requiresApiKey: true },
  'browser-native-tts': { defaultBaseUrl: '', requiresApiKey: false },
}

const TTS_MODELS: Partial<Record<TtsTabId, { id: string; name: string }[]>> = {
  'qwen-tts': [
    { id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash' },
    { id: 'qwen3-tts-instruct-flash', name: 'Qwen3 TTS Instruct Flash' },
    { id: 'qwen-tts', name: 'Qwen TTS' },
  ],
  'minimax-tts': [
    { id: 'speech-2.8-hd', name: 'Speech 2.8 HD' },
    { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo' },
    { id: 'speech-2.6-hd', name: 'Speech 2.6 HD' },
    { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo' },
    { id: 'speech-02-hd', name: 'Speech 02 HD' },
    { id: 'speech-02-turbo', name: 'Speech 02 Turbo' },
  ],
}

const TTS_VOICES: Record<TtsTabId, { id: string; name: string }[]> = {
  'glm-tts': [
    { id: 'tongtong', name: '彤彤' },
    { id: 'chuichui', name: '锤锤' },
    { id: 'xiaochen', name: '小陈' },
    { id: 'jam', name: 'Jam' },
    { id: 'kazi', name: 'Kazi' },
    { id: 'douji', name: '豆几' },
    { id: 'luodo', name: '罗多' },
  ],
  'qwen-tts': [
    { id: 'Cherry', name: '芊悦 (Cherry)' },
    { id: 'Serena', name: '苏瑶 (Serena)' },
    { id: 'Ethan', name: '晨煦 (Ethan)' },
    { id: 'Chelsie', name: '千雪 (Chelsie)' },
    { id: 'Momo', name: '茉兔 (Momo)' },
    { id: 'Vivian', name: '十三 (Vivian)' },
    { id: 'Moon', name: '月白 (Moon)' },
    { id: 'Maia', name: '四月 (Maia)' },
    { id: 'Kai', name: '凯 (Kai)' },
    { id: 'Neil', name: '阿闻 (Neil)' },
    { id: 'Elias', name: '墨讲师 (Elias)' },
    { id: 'Seren', name: '小婉 (Seren)' },
    { id: 'Jennifer', name: '詹妮弗 (Jennifer)' },
    { id: 'Aiden', name: '艾登 (Aiden)' },
    { id: 'Andre', name: '安德雷 (Andre)' },
    { id: 'Arthur', name: '徐大爷 (Arthur)' },
    { id: 'Vincent', name: '田叔 (Vincent)' },
    { id: 'Ryan', name: '甜茶 (Ryan)' },
    { id: 'Jada', name: '上海-阿珍 (Jada)' },
    { id: 'Dylan', name: '北京-晓东 (Dylan)' },
    { id: 'Li', name: '南京-老李 (Li)' },
    { id: 'Marcus', name: '陕西-秦川 (Marcus)' },
    { id: 'Roy', name: '闽南-阿杰 (Roy)' },
    { id: 'Peter', name: '天津-李彼得 (Peter)' },
    { id: 'Sunny', name: '四川-晴儿 (Sunny)' },
    { id: 'Eric', name: '四川-程川 (Eric)' },
    { id: 'Rocky', name: '粤语-阿强 (Rocky)' },
    { id: 'Kiki', name: '粤语-阿清 (Kiki)' },
    { id: 'Bodega', name: '博德加 (Bodega)' },
    { id: 'Sonrisa', name: '索尼莎 (Sonrisa)' },
    { id: 'Alek', name: '阿列克 (Alek)' },
    { id: 'Dolce', name: '多尔切 (Dolce)' },
    { id: 'Sohee', name: '素熙 (Sohee)' },
    { id: 'Ono Anna', name: '小野杏 (Ono Anna)' },
    { id: 'Lenn', name: '莱恩 (Lenn)' },
    { id: 'Emilien', name: '埃米尔安 (Emilien)' },
    { id: 'Radio Gol', name: '拉迪奥·戈尔 (Radio Gol)' },
  ],
  'minimax-tts': [
    { id: 'male-qn-jingying', name: '精英青年' },
    { id: 'male-qn-jingying-jingpin', name: '精英青年·精品' },
    { id: 'female-chengshu', name: '成熟女性' },
    { id: 'female-chengshu-jingpin', name: '成熟女性·精品' },
    { id: 'Patient_Man', name: 'Patient Man（耐心男声）' },
    { id: 'Wise_Woman', name: 'Wise Woman（智慧女声）' },
    { id: 'Calm_Woman', name: 'Calm Woman（沉稳女声）' },
    { id: 'Elegant_Man', name: 'Elegant Man（儒雅男声）' },
    { id: 'presenter_male', name: '男性主播' },
    { id: 'presenter_female', name: '女性主播' },
    { id: 'audiobook_male_1', name: '有声书男声·1' },
    { id: 'audiobook_male_2', name: '有声书男声·2' },
    { id: 'audiobook_female_1', name: '有声书女声·1' },
    { id: 'audiobook_female_2', name: '有声书女声·2' },
    { id: 'Chinese (Mandarin)_Gentleman', name: '温润男声' },
    { id: 'Chinese (Mandarin)_News_Anchor', name: '新闻女声' },
    { id: 'Chinese (Mandarin)_Radio_Host', name: '电台男主播' },
    { id: 'Chinese (Mandarin)_Reliable_Executive', name: '沉稳高管' },
    { id: 'Lovely_Girl', name: 'Lovely Girl（可爱女孩）' },
    { id: 'Sweet_Girl_2', name: 'Sweet Girl（甜美女孩）' },
    { id: 'Decent_Boy', name: 'Decent Boy（乖巧男孩）' },
    { id: 'Lively_Girl', name: 'Lively Girl（活泼少女）' },
    { id: 'Exuberant_Girl', name: 'Exuberant Girl（活力少女）' },
    { id: 'Young_Knight', name: 'Young Knight（少年）' },
    { id: 'Inspirational_girl', name: 'Inspirational Girl（励志女生）' },
    { id: 'Casual_Guy', name: 'Casual Guy（随和男生）' },
    { id: 'male-qn-qingse', name: '青涩青年' },
    { id: 'male-qn-qingse-jingpin', name: '青涩青年·精品' },
    { id: 'female-shaonv', name: '少女' },
    { id: 'female-shaonv-jingpin', name: '少女·精品' },
    { id: 'female-tianmei', name: '甜美女声' },
    { id: 'female-tianmei-jingpin', name: '甜美女声·精品' },
    { id: 'Chinese (Mandarin)_Warm_Girl', name: '温暖少女' },
    { id: 'Chinese (Mandarin)_Warm_Bestie', name: '温暖闺蜜' },
    { id: 'English_Trustworthy_Man', name: 'Trustworthy Man' },
    { id: 'English_Graceful_Lady', name: 'Graceful Lady' },
    { id: 'English_expressive_narrator', name: 'Expressive Narrator' },
  ],
  'doubao-tts': [
    { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0' },
    { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 2.0' },
    { id: 'zh_male_m191_uranus_bigtts', name: '云舟 2.0' },
    { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 2.0' },
    { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞 2.0' },
    { id: 'zh_female_qingxinnvsheng_uranus_bigtts', name: '清新女声 2.0' },
    { id: 'zh_female_cancan_uranus_bigtts', name: '知性灿灿 2.0' },
    { id: 'zh_female_shuangkuaisisi_uranus_bigtts', name: '爽快思思 2.0' },
    { id: 'zh_male_shaonianzixin_uranus_bigtts', name: '少年梓辛 2.0' },
    { id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰 2.0' },
    { id: 'zh_female_yingyujiaoxue_uranus_bigtts', name: 'Tina老师 2.0' },
    { id: 'zh_female_kefunvsheng_uranus_bigtts', name: '暖阳女声 2.0' },
    { id: 'en_male_tim_uranus_bigtts', name: 'Tim' },
    { id: 'en_female_dacey_uranus_bigtts', name: 'Dacey' },
    { id: 'en_female_stokie_uranus_bigtts', name: 'Stokie' },
  ],
  'browser-native-tts': [{ id: 'default', name: '默认' }],
}

/* ── Settings type ── */
interface TtsProviderConfig {
  apiKey?: string
  baseUrl?: string
  modelId?: string
}

interface TtsSettings {
  activeProvider: TtsTabId
  activeVoice: string
  providers: Partial<Record<TtsTabId, TtsProviderConfig>>
}

const DEFAULT_SETTINGS: TtsSettings = {
  activeProvider: 'glm-tts',
  activeVoice: 'tongtong',
  providers: {},
}

/* ── Component ── */
export function TtsSettings() {
  const [settings, setSettings] = useState<TtsSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TtsTabId>('glm-tts')
  const [showKey, setShowKey] = useState(false)
  const [localVoice, setLocalVoice] = useState<Partial<Record<TtsTabId, string>>>({})
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/config/settings?key=tts_settings')
      .then(r => r.json())
      .then(data => {
        if (data.value) {
          try {
            const parsed = JSON.parse(data.value) as TtsSettings
            setSettings(parsed)
            setActiveTab(parsed.activeProvider)
          } catch { /* use defaults */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const providerConfig = settings.providers[activeTab] ?? {}
  const isBrowserNative = activeTab === 'browser-native-tts'
  const isDoubao = activeTab === 'doubao-tts'
  const meta = TTS_PROVIDER_META[activeTab]
  const models = TTS_MODELS[activeTab] ?? []
  const voices = TTS_VOICES[activeTab] ?? []

  const rawKey = providerConfig.apiKey || ''
  const colonIdx = rawKey.indexOf(':')
  const doubaoAppId = isDoubao && colonIdx > 0 ? rawKey.slice(0, colonIdx) : ''
  const doubaoAccessKey = isDoubao && colonIdx > 0 ? rawKey.slice(colonIdx + 1) : isDoubao ? rawKey : ''

  const updateConfig = useCallback((patch: Partial<TtsProviderConfig>) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [activeTab]: { ...prev.providers[activeTab], ...patch },
      },
    }))
  }, [activeTab])

  const setDoubaoKey = useCallback((appId: string, accessKey: string) => {
    const combined = appId && accessKey ? `${appId}:${accessKey}` : appId || accessKey
    updateConfig({ apiKey: combined })
  }, [updateConfig])

  const effectiveVoice = activeTab === settings.activeProvider
    ? settings.activeVoice
    : localVoice[activeTab] ?? voices[0]?.id ?? 'default'

  const handleVoiceSelect = (voiceId: string) => {
    if (activeTab === settings.activeProvider) {
      setSettings(prev => ({ ...prev, activeVoice: voiceId }))
    } else {
      setLocalVoice(prev => ({ ...prev, [activeTab]: voiceId }))
    }
  }

  const handlePlayVoice = async (voiceId: string, voiceName: string) => {
    handleVoiceSelect(voiceId)
    if (isBrowserNative) {
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(`您好，我是${voiceName}，这是一段语音试听。`)
      setPlayingVoiceId(voiceId)
      utter.onend = () => setPlayingVoiceId(null)
      utter.onerror = () => setPlayingVoiceId(null)
      window.speechSynthesis.speak(utter)
      return
    }
    const apiKey = providerConfig.apiKey || ''
    if (!apiKey) return
    setPlayingVoiceId(voiceId)
    try {
      const res = await fetch('/api/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: activeTab, voiceId, apiKey,
          baseUrl: providerConfig.baseUrl || '',
          modelId: providerConfig.modelId || '',
          text: `您好，我是${voiceName}，这是一段语音试听。`,
        }),
      })
      if (!res.ok) { setPlayingVoiceId(null); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => { setPlayingVoiceId(null); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPlayingVoiceId(null); URL.revokeObjectURL(url) }
      audio.play()
    } catch { setPlayingVoiceId(null) }
  }

  const handleActivate = async () => {
    setSaving(true)
    const voiceToApply = activeTab === settings.activeProvider
      ? settings.activeVoice
      : localVoice[activeTab] ?? voices[0]?.id ?? 'default'
    const next: TtsSettings = { ...settings, activeProvider: activeTab, activeVoice: voiceToApply }
    setSettings(next)
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'tts_settings', value: JSON.stringify(next) }),
      })
      setActivateMsg('✓ 已激活')
      setTimeout(() => setActivateMsg(null), 2000)
    } catch { setActivateMsg('保存失败') }
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, fontSize: 13,
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 7, padding: '7px 12px', outline: 'none',
  }

  const eyeButtonStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface-high)',
    color: 'var(--color-text-muted)',
    display: 'flex', alignItems: 'center', flexShrink: 0,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--color-text-muted)',
    letterSpacing: '0.04em', textTransform: 'uppercase' as const,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Provider Tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TTS_ORDER.map(id => {
          const isActive = id === activeTab
          const isCurrent = id === settings.activeProvider
          return (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setShowKey(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 12px', borderRadius: 8, whiteSpace: 'nowrap',
                border: isActive
                  ? '1px solid rgba(245,158,11,0.45)'
                  : '1px solid var(--color-border-subtle)',
                background: isActive ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: isActive ? '#F59E0B' : 'var(--color-text-muted)',
                fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {TTS_LABELS[id]}
              {isCurrent && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Config Panel */}
      {isBrowserNative ? (
        <div style={{
          padding: 20,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 10,
        }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 6 }}>
            浏览器内置语音合成
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: '1.7' }}>
            使用操作系统提供的语音合成能力，无需 API Key。<br />
            音质和语言支持取决于系统安装的语音包，适合快速体验或离线场景。
          </p>
        </div>
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 16,
          padding: 16,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 10,
        }}>
          {/* API Key */}
          {isDoubao ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>App ID &amp; Access Key</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={doubaoAppId}
                  onChange={e => setDoubaoKey(e.target.value, doubaoAccessKey)}
                  placeholder="App ID"
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <input
                  type={showKey ? 'text' : 'password'}
                  value={doubaoAccessKey}
                  onChange={e => setDoubaoKey(doubaoAppId, e.target.value)}
                  placeholder="Access Key"
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <button onClick={() => setShowKey(v => !v)} style={eyeButtonStyle}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>API Key</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={providerConfig.apiKey || ''}
                  onChange={e => updateConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <button onClick={() => setShowKey(v => !v)} style={eyeButtonStyle}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Base URL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>Base URL</label>
            <input
              type="text"
              value={providerConfig.baseUrl || ''}
              onChange={e => updateConfig({ baseUrl: e.target.value })}
              placeholder={meta.defaultBaseUrl || '留空使用默认端点'}
              style={{ ...inputStyle, flex: 'unset', width: '100%' }}
            />
          </div>

          {/* Voice List */}
          {voices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>语音音色</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                {voices.map(v => {
                  const isSelected = effectiveVoice === v.id
                  const isPlaying = playingVoiceId === v.id
                  return (
                    <div
                      key={v.id}
                      onClick={() => handleVoiceSelect(v.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
                        background: isSelected ? 'rgba(245,158,11,0.08)' : 'transparent',
                        border: isSelected ? '1px solid rgba(245,158,11,0.25)' : '1px solid transparent',
                        transition: 'all 0.12s',
                      }}
                    >
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: isSelected ? '#F59E0B' : 'var(--color-border-strong)',
                        transition: 'background 0.12s',
                      }} />
                      <span style={{ flex: 1, fontSize: 13, color: isSelected ? '#F59E0B' : 'var(--color-text-secondary)' }}>
                        {v.name}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); handlePlayVoice(v.id, v.name) }}
                        title="试听"
                        style={{
                          width: 24, height: 24, borderRadius: 6,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1px solid var(--color-border-subtle)',
                          background: isPlaying ? 'rgba(245,158,11,0.15)' : 'var(--color-bg-surface-high)',
                          color: isPlaying ? '#F59E0B' : 'var(--color-text-muted)',
                          cursor: 'pointer', flexShrink: 0, transition: 'all 0.12s',
                        }}
                      >
                        {isPlaying ? <CheckCircle size={11} /> : <Volume2 size={11} />}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Model Selector */}
          {models.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>模型</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {models.map(m => {
                  const currentModelId = providerConfig.modelId || models[0]?.id
                  const isSelected = currentModelId === m.id
                  return (
                    <button
                      key={m.id}
                      onClick={() => updateConfig({ modelId: m.id })}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                        border: isSelected ? '1px solid rgba(245,158,11,0.45)' : '1px solid var(--color-border-subtle)',
                        background: isSelected ? 'rgba(245,158,11,0.1)' : 'var(--color-bg-surface-high)',
                        color: isSelected ? '#F59E0B' : 'var(--color-text-muted)',
                        fontFamily: 'monospace', transition: 'all 0.12s',
                      }}
                    >
                      {m.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleActivate}
          disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 20px', borderRadius: 8,
            fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer',
            background: '#F59E0B', border: 'none',
            color: '#12100a', fontWeight: 600,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          激活此语音
        </button>

        {activateMsg && (
          <span style={{ fontSize: 12, color: activateMsg.startsWith('✓') ? '#16a34a' : '#dc2626' }}>
            {activateMsg}
          </span>
        )}

        {!isBrowserNative && !(providerConfig.apiKey) && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            填写 API Key 后可试听音色
          </span>
        )}
      </div>
    </div>
  )
}
