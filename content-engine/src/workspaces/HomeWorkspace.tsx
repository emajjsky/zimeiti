import {
  ArrowRight,
  BookOpenCheck,
  ChartColumn,
  CheckCircle2,
  Compass,
  ExternalLink,
  FilePenLine,
  KeyRound,
  RadioTower,
  Rss,
  Settings2,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LocalState } from '../data/localRepository';
import { webAccountVoices, webAgent, webChannelAccounts, webIntelligence, webModels } from '../data/webApi';
import type { ModelSection, SettingsSection, View } from '../app/navigation.mjs';

type ConfigItem = {
  id: string;
  title: string;
  description: string;
  instructions: string[];
  action: string;
  externalLabel: string;
  externalHref: string;
  icon: LucideIcon;
  complete: boolean;
  open: () => void;
};

const mermaidSource = `flowchart LR
  A[发现题材 / 个人创意] --> B[建立创作项目]
  B --> C[内容准备与研究]
  C --> D[生成并采用公众号正文]
  D --> E[策划并生成配图]
  E --> F[排版预览与确认]
  F --> G[导入公众号草稿箱]
  G --> H[公众号后台正式发布]
  H --> I[登记公开链接]
  I --> J[数据复盘与经验沉淀]
  J -. 经验回流 .-> C`;

const requiredPolicyTasks = new Set([
  'INTELLIGENCE_ANALYSIS', 'SOURCE_VERIFICATION', 'TITLE_RECOMMENDATION', 'VOICE_CALIBRATION',
  'WECHAT_COPY_GENERATION', 'WECHAT_VISUAL_PLANNING', 'WECHAT_LAYOUT_DESIGN', 'TEXT_TO_IMAGE', 'VIDEO_ANALYSIS',
]);

export function HomeWorkspace({ onNavigate, onOpenSettings }: {
  state: LocalState;
  onNavigate: (view: View) => void;
  onOpenSettings: (section: SettingsSection, modelSection?: ModelSection) => void;
}) {
  const [readiness, setReadiness] = useState({ bailian: false, search: false, policies: false, sources: false, account: false, voice: false });

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      webAgent.credentialStatus(),
      webIntelligence.webSearchStatus(),
      webModels.taskPolicies(),
      webIntelligence.listSources(),
      webChannelAccounts.list(),
      webAccountVoices.list(),
    ]).then(([bailian, search, policies, sources, accounts, voices]) => {
      if (!active) return;
      setReadiness({
        bailian: bailian.status === 'fulfilled' && bailian.value.status === 'READY',
        search: search.status === 'fulfilled' && search.value.status === 'READY',
        policies: policies.status === 'fulfilled' && [...requiredPolicyTasks].every((task) => policies.value.some((item) => item.task === task && Boolean(item.model))),
        sources: sources.status === 'fulfilled' && sources.value.some((item) => item.enabled),
        account: accounts.status === 'fulfilled' && accounts.value.accounts.some((item) => item.platform === 'WECHAT'),
        voice: voices.status === 'fulfilled' && voices.value.voices.length > 0,
      });
    });
    return () => { active = false; };
  }, []);

  const config: ConfigItem[] = [
    {
      id: 'bailian', title: '配置阿里云百炼 API',
      description: '百炼负责正文、分析、配图和排版等模型任务。',
      instructions: ['打开百炼控制台并登录阿里云账号。', '进入 API Key 页面创建密钥。', '回到设置，粘贴密钥并点击保存、验证。'],
      action: '去配置百炼', externalLabel: '打开百炼控制台', externalHref: 'https://bailian.console.aliyun.com/', icon: KeyRound,
      complete: readiness.bailian, open: () => onOpenSettings('models', 'bailian'),
    },
    {
      id: 'search', title: '配置检索 API',
      description: 'Tavily 为网络检索提供实时题材、来源和事实线索。',
      instructions: ['注册或登录 Tavily 并创建 API Key。', '复制密钥回到设置的“检索 API”。', '保存后点击检测，状态显示“已验证”才算完成。'],
      action: '去配置检索', externalLabel: '获取 Tavily Key', externalHref: 'https://app.tavily.com/home', icon: Compass,
      complete: readiness.search, open: () => onOpenSettings('models', 'search'),
    },
    {
      id: 'policies', title: '配置任务策略',
      description: '为热点分析、正文生成、配图和排版选择实际执行模型。',
      instructions: ['进入“任务策略”并逐项检查任务。', '为需要的任务选择模型与连接。', '保存后确认策略列表中的模型均已生效。'],
      action: '配置任务策略', externalLabel: '查看模型说明', externalHref: 'https://help.aliyun.com/zh/model-studio/getting-started/models', icon: Workflow,
      complete: readiness.policies, open: () => onOpenSettings('models', 'policies'),
    },
    {
      id: 'sources', title: '配置资讯来源',
      description: '启用 RSS、网络搜索或自定义来源，让发现页有稳定输入。',
      instructions: ['进入资讯来源设置。', '启用已有来源，或添加 RSS 地址。', '返回发现页刷新，确认能读到新资讯。'],
      action: '配置资讯来源', externalLabel: '查看 RSSHub 文档', externalHref: 'https://docs.rsshub.app/', icon: Rss,
      complete: readiness.sources, open: () => onOpenSettings('sources'),
    },
    {
      id: 'account', title: '配置公众号平台账号',
      description: '配置公众号账号后，才能把完成的母稿导入草稿箱。',
      instructions: ['进入公众号开发者平台，准备 AppID、AppSecret。', '先把服务器出口 IP 加入白名单。', '回到账号授权保存并验证凭证。'],
      action: '配置公众号账号', externalLabel: '打开微信开发者平台', externalHref: 'https://mp.weixin.qq.com/', icon: RadioTower,
      complete: readiness.account, open: () => onOpenSettings('accounts'),
    },
    {
      id: 'voice', title: '配置账号声音',
      description: '导入自己的文章作为写作风格参考，沉淀为可复用的账号声音。',
      instructions: ['准备一篇或多篇自己拥有使用权的公众号文章链接。', '在账号声音中导入链接并确认授权。', '审核提炼出的规则后设为默认声音。'],
      action: '导入写作参考', externalLabel: '打开公众号后台', externalHref: 'https://mp.weixin.qq.com/', icon: UserRound,
      complete: readiness.voice, open: () => onOpenSettings('voices'),
    },
  ];
  const next = config.find((item) => !item.complete) ?? null;
  const completed = config.filter((item) => item.complete).length;
  const primaryAction = next?.action ?? '开始创作';
  const primaryOpen = next?.open ?? (() => onNavigate('create'));

  return <section className="home-workspace">
    <header className="home-intro">
      <div className="home-intro-copy">
        <span className="home-kicker">公众号内容工作台</span>
        <h1>先把工作台配置好，再开始写第一篇。</h1>
        <p>按照六项配置完成基础准备，之后每次创作都可以沿着清晰的公众号母稿流程推进。</p>
        <div className="home-intro-actions">
          <button className="button primary" type="button" onClick={primaryOpen}>{primaryAction}<ArrowRight size={16}/></button>
          <button className="button" type="button" onClick={() => onNavigate('today')}>查看今日任务</button>
        </div>
      </div>
      <aside className="home-next-action" aria-label="下一步操作">
        <Settings2 size={24}/>
        <span>{next ? '建议下一步' : '工作台已就绪'}</span>
        <strong>{next?.title ?? '开始正式创作'}</strong>
        <p>{next ? `${completed} / ${config.length} 项已完成，继续完成配置。` : '六项配置均已完成，可以进入正式创作。'}</p>
      </aside>
    </header>

    <div className="home-section-heading">
      <div><span className="home-section-kicker">FIRST RUN</span><h2>首次使用配置</h2><p>按顺序完成下面六项设置。每张卡片都提供操作说明和官方入口。</p></div>
      <span className="home-readiness-count">{completed} / {config.length} 已完成</span>
    </div>
    <div className="home-config-grid" aria-label="首次使用配置步骤">
      {config.map((item, index) => {
        const Icon = item.icon;
        return <article className={`home-config-item ${item.id === next?.id ? 'current' : ''}`} key={item.id}>
          <div className="home-config-top"><span className="home-config-index">{String(index + 1).padStart(2, '0')}</span><div className="home-config-icon"><Icon size={21}/></div>{item.complete && <span className="home-config-status"><CheckCircle2 size={14}/>已完成</span>}</div>
          <h3>{item.title}</h3><p>{item.description}</p>
          <ol>{item.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
          <div className="home-config-actions"><button className="button primary" type="button" onClick={item.open}>{item.action}<ArrowRight size={15}/></button><a className="text-button" href={item.externalHref} target="_blank" rel="noreferrer">{item.externalLabel}<ExternalLink size={14}/></a></div>
        </article>;
      })}
    </div>

    <section className="home-creation-guide" aria-labelledby="home-creation-title">
      <div className="home-section-heading"><div><span className="home-section-kicker">CREATION FLOW</span><h2 id="home-creation-title">正式创作流程</h2><p>创作完成后，发布、登记和复盘会把结果继续沉淀为下一篇的依据。</p></div><button className="button" type="button" onClick={() => onNavigate('create')}><FilePenLine size={16}/>开始创作</button></div>
      <div className="home-mermaid" data-mermaid-source={mermaidSource} role="img" aria-label="正式创作流程图">
        <div className="home-flow-branch"><span>输入</span><strong>发现题材</strong><strong>个人创意</strong><strong>已有草稿</strong></div>
        {['建立项目', '内容准备与研究', '生成并采用正文', '策划并生成配图', '排版预览与确认', '导入公众号草稿箱', '公众号后台正式发布', '登记公开链接', '数据复盘'].map((label, index) => <div className="home-flow-node" key={label}><span>{String(index + 1).padStart(2, '0')}</span><strong>{label}</strong>{index < 8 && <ArrowRight size={17}/>}</div>)}
        <div className="home-flow-return"><ChartColumn size={16}/>复盘经验回流到下一次内容准备</div>
      </div>
      <details className="home-mermaid-source"><summary>查看 Mermaid 源码</summary><pre>{mermaidSource}</pre></details>
    </section>

    <footer className="home-help"><div><BookOpenCheck size={21}/><span><b>随时回到首页</b><small>操作中断不会丢失，系统会保存当前工作状态。</small></span></div><button className="text-button" type="button" onClick={() => onOpenSettings('models', 'bailian')}>检查模型配置<ArrowRight size={14}/></button></footer>
  </section>;
}
