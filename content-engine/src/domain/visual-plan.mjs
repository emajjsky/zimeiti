export const VISUAL_PLAN_VERSION = 8;

const platformLabels = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
  ZHIHU: '知乎',
  WEIBO: '微博',
};

const stopWords = new Set([
  '一个', '一些', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '自己', '已经', '还是', '可以', '可能',
  '如何', '为什么', '什么', '没有', '不是', '就是', '进行', '通过', '关于', '以及', '其中', '目前', '今天', '现在',
  '成功', '正式', '首次', '最新', '消息', '新闻', '内容', '文章', '观点', '问题', '我国', '中国',
  '一代', '能力', '提升', '承担', '之间', '送入', '关注', '重点', '实际', '后续', '预定',
]);

const commonConcepts = [
  '中继卫星', '运载火箭', '航天器测控', '数据传输', '数据中继', '卫星发射', '卫星通信', '地面站', '空间站',
  '人工智能', '生成式AI', '大语言模型', '大模型', '自动驾驶', '新能源汽车', '科技创新',
  '资本市场', '货币政策', '股票市场', '上市公司', '电子商务', '国际关系', '社会治理',
  '传统文化', '历史人物', '体育赛事', '影视作品', '公共卫生', '医疗健康', '教育改革',
];

const semanticConceptRules = [
  [/组网/, '卫星组网'], [/测控.*覆盖|覆盖.*测控/, '测控覆盖'], [/工作原理|运行原理|机制/, '工作原理'],
  [/应用|服务能力|使用场景/, '应用场景'], [/天地通信|卫星通信/, '卫星通信'], [/数据.*转发|转发.*数据/, '数据转发'],
  [/空间实验|实验舱|空间站/, '空间实验室'], [/政策/, '政策机制'], [/产业链/, '产业链'], [/供应链/, '供应链'],
  [/增长|下降|变化趋势|同比|环比/, '变化趋势'], [/影响|作用|意义/, '影响关系'], [/流程|步骤|路径/, '工作流程'],
];

const visualTypeLabels = {
  NEWS_PHOTO: '新闻资料图',
  HERO_VISUAL: '人物或物品主视觉',
  CONCEPT_DIAGRAM: '概念示意图',
  SCENE: '场景图',
  MIND_MAP: '思维导图',
  FLOWCHART: '流程图',
  TIMELINE: '时间线',
  COMPARISON: '对比图',
  DATA_CHART: '数据图',
  QUOTE_CARD: '引语卡片',
  INFO_CARD: '信息卡片',
  CHECKLIST_CARD: '清单卡片',
};

const stylePresets = [
  {
    id: 'FRESH_EDITORIAL', name: '清新杂志', group: 'EDITORIAL', description: '明亮留白，适合人物、生活方式与通用长文', swatches: ['#F7FAFC', '#B9D8F2', '#F5C8D8', '#24324A'],
    prompt: '明亮当代编辑摄影；珍珠白环境，雾蓝、浅珊瑚粉与少量深海军蓝；柔和北向窗光，纸张与亚麻材质真实；人物动作自然，非对称全画幅构图，空间通透但不空洞，细节清晰克制',
  },
  {
    id: 'BUSINESS_EDITORIAL', name: '商业杂志', group: 'EDITORIAL', description: '克制、成熟，适合财经、公司与行业分析', swatches: ['#F3F5F7', '#25324B', '#7EA0C4', '#C9A86A'],
    prompt: 'Mature contemporary business editorial photography; cool white, graphite blue, steel blue and muted brass; disciplined real creator workspace with printed research, market evidence, photographs and calm decision-making energy; precise lighting, premium magazine finish, confident crop, tactile paper and metal details; avoid trading-screen cliches, money symbols, luxury black-gold tone and success-coach theatrics',
  },
  {
    id: 'SWISS_GRID', name: '瑞士网格', group: 'EDITORIAL', description: '强网格与高对比，适合观点、清单与专题封面', swatches: ['#F5F4F0', '#171717', '#E74B3C', '#2F67C7'],
    prompt: '瑞士国际主义艺术方向；暖白、纯黑、信号红与钴蓝；把不对称几何、严格对齐和大胆裁切融入真实主体与环境，画面节奏利落，保留哑光印刷颗粒，不出现文字海报感',
  },
  {
    id: 'DOCUMENTARY', name: '纪实报道', group: 'EDITORIAL', description: '真实自然，适合新闻、人物与现场资料', swatches: ['#E7E4DE', '#6F786F', '#A98D70', '#28312F'],
    prompt: '克制的纪实报道摄影；自然光、真实材质与真实环境色，低饱和灰绿和中性肤色；观察式构图，保留环境关系与现场细节；轻微胶片颗粒，锐度自然；不摆拍、不磨皮、不制造戏剧冲突，不伪造新闻现场、机构标识或人物行为',
  },
  {
    id: 'CINEMATIC_DOCUMENTARY', name: '电影纪实', group: 'EDITORIAL', description: '叙事光影更强，适合故事、人物与社会议题', swatches: ['#17212B', '#54707D', '#D49B72', '#D9D5CC'],
    prompt: '电影感纪实摄影；蓝灰阴影、自然暖肤色和低饱和环境色；真实可解释的侧光或窗光，前中后景层次清楚；克制胶片颗粒与柔和高光，人物动作真实，画面有叙事张力但保持事实边界，所有关键细节可辨',
  },
  {
    id: 'MINIMAL_KNOWLEDGE', name: '极简知识图', group: 'KNOWLEDGE', description: '少色高密度，适合方法、结构与知识解释', swatches: ['#FAFAF7', '#DCE8F5', '#F3D58A', '#27364A'],
    prompt: '极简知识型编辑艺术；近白空间，雾蓝、浅黄和深灰蓝；以一个真实核心主体和少量精确物理线索表现收集、筛选与综合，细技术线只作克制辅助，负空间严谨，扁平印刷质感，不做文字化示意板',
  },
  {
    id: 'DATA_VISUAL', name: '数据可视化', group: 'KNOWLEDGE', description: '数据关系优先，适合趋势、对比与财经信息', swatches: ['#F7F9FB', '#2D6CDF', '#22A67A', '#F0B44D'],
    prompt: '数据启发的编辑艺术；冷白、清晰蓝绿与一个琥珀色落点；让照片、笔记或真实对象在空间中呈现汇入、过滤和重组的可见运动，色彩语义一致，景深清楚，关系准确，不做仪表盘或信息面板',
  },
  {
    id: 'BLUEPRINT_DIAGRAM', name: '蓝图图解', group: 'KNOWLEDGE', description: '工程结构感，适合技术原理、流程与系统关系', swatches: ['#EAF2F7', '#315A78', '#7CA5BC', '#F2B66D'],
    prompt: '现代工程蓝图图解；浅灰蓝纸底、深蓝线稿、雾青辅助线和少量橙色关键标记；轴测或正投影视角，结构关系、连线和编号精确；细密但可读的技术绘图质感；避免纯深蓝底老式蓝图、科幻HUD、无意义电路线和无法解释的机械细节',
  },
  {
    id: 'HAND_DRAWN_NOTES', name: '手绘笔记', group: 'KNOWLEDGE', description: '亲和、有温度，适合教程、读书与个人经验', swatches: ['#FFFDF5', '#466B5B', '#E5A65B', '#D97873'],
    prompt: '干净的手绘编辑纪实；暖白纸、墨绿色线条、赭黄与珊瑚红点缀；以有轻重和停顿的观察性线条描绘人物整理真实资料，箭头和圈线只作为无文字动作痕迹，保留笔压与纸纤维，成熟克制',
  },
  {
    id: 'RETRO_POP', name: '清新波普怀旧', group: 'ILLUSTRATION', description: '马卡龙撞色与复古印刷，轻快但不俗气', swatches: ['#BFE3E0', '#F7B7C5', '#F6D76B', '#315D8A'],
    prompt: '成熟的复古波普编辑插画；薄荷绿、婴儿蓝、珊瑚粉、奶油黄与深海军蓝；丝网印刷网点、轻微错版和大胆裁切形状贯穿全画面，人物动作有活力，扁平油墨质感，视觉重心明确但不幼稚',
  },
  {
    id: 'PAPER_COLLAGE', name: '纸感拼贴', group: 'ILLUSTRATION', description: '照片与纸片混合，适合人文、历史与观点表达', swatches: ['#F1EEE8', '#91A8A4', '#D88373', '#3B4252'],
    prompt: '现代纸感编辑拼贴；灰白纸、鼠尾草绿、陶土红和深灰蓝；以纪实照片裁片、撕边色纸和少量铅笔线组成单一连贯场景，视觉中心清楚，纸张阴影浅而真实，避免剪贴簿式杂乱',
  },
  {
    id: 'FLAT_GEOMETRIC', name: '扁平几何', group: 'ILLUSTRATION', description: '简洁现代，适合概念、商业与产品场景', swatches: ['#F6F7F2', '#5A8DEE', '#64C2A6', '#F2A65A'],
    prompt: 'Refined flat geometric editorial illustration; neutral bright field, cobalt blue, teal and warm orange; simplified creator and desk objects built from crisp geometric shapes with unified perspective and confident negative space; relationships are readable through scale, overlap and gesture; avoid generic corporate stock art, purple AI gradients, floating blobs and over-rounded toy shapes',
  },
  {
    id: 'SOFT_3D', name: '柔和 3D', group: 'ILLUSTRATION', description: '有体积但不过分卡通，适合产品与概念主视觉', swatches: ['#F2F5F7', '#9CC8E8', '#B9D6B0', '#F0B6A8'],
    prompt: '柔和编辑型 3D 场景；冷白空间，雾蓝、嫩绿和浅珊瑚；哑光陶瓷与纸张材质，柔和全局光和精确接触阴影；人物、资料和工具之间的物理关系清楚，雕塑式构图优雅，不呈现塑料玩具感',
  },
  {
    id: 'NEW_CHINESE', name: '新中式', group: 'CULTURAL', description: '东方秩序与现代编辑感，适合文化、国学与品牌', swatches: ['#F4F1EA', '#4D665A', '#B84A3A', '#28312E'],
    prompt: '当代新中式编辑艺术；宣纸白、矿物灰绿、朱砂红和墨黑；现代人物工作场景中使用克制的木、陶、纸与织物，东方负空间和纵向节奏融入横向全画幅，气质安静清醒，不用古装或民俗装饰堆砌',
  },
  {
    id: 'INK_WASH', name: '水墨留白', group: 'CULTURAL', description: '轻墨与大留白，适合诗词、哲思与人文内容', swatches: ['#F7F6F1', '#262B2C', '#899A91', '#B75A4A'],
    prompt: 'Contemporary ink-wash editorial artwork; xuan-paper white, ink black, gray green and one cinnabar accent; a modern creator workspace is rendered with dry-wet ink variation, restrained brush texture, calm negative space and a few precise physical research objects; subtle modern geometry may appear only as spatial rhythm; avoid scroll borders, calligraphy gibberish, costume drama faces and generic landscape templates',
  },
  {
    id: 'GUOCHAO_POSTER', name: '现代国潮', group: 'CULTURAL', description: '高对比东方图形，适合节日、历史与强传播封面', swatches: ['#F0E8D8', '#D33C32', '#216A70', '#202329'],
    prompt: 'Modern guochao editorial art direction translated into one full scene; rice-white paper, vivid red, peacock teal and carbon black; creator desk, cultural objects and research photos are unified through bold crop, layered graphic shapes and controlled overprint color; traditional patterns appear only as small structural accents; avoid gold overload, dragon-phoenix clouds, tourist souvenir styling and decorative lettering',
  },
  {
    id: 'MINERAL_FRESCO', name: '矿物壁画', group: 'CULTURAL', description: '矿物色与壁画质感，适合历史、人文与非遗主题', swatches: ['#F3E6C8', '#2F6F83', '#B95D36', '#6D8B55'],
    prompt: 'Contemporary mineral-pigment fresco editorial image; warm lime-plaster ground, malachite green, lapis blue, cinnabar and muted ochre; creator studies cultural material samples, photographs and paper fragments in a quiet studio scene with matte fresco texture, softened edges and layered mineral color; respectful museum-grade atmosphere; avoid religious iconography, tourist murals, antique yellow wash, fake symbols and unreadable text',
  },
  {
    id: 'TECH_MEDIA', name: '科技媒体', group: 'TECHNOLOGY', description: '精准、冷静，适合 AI、互联网与产业科技', swatches: ['#F3F6F8', '#2864DC', '#29A38A', '#1E293B'],
    prompt: 'Modern technology media editorial photography; pale cool gray, cobalt blue, teal green and deep graphite; a real creator workspace with hardware samples, research photos and transparent optical links arranged with precision and calm hierarchy; bright clean light and explainable relationships; avoid purple neon gradients, glowing brains, robot silhouettes, code rain, HUD interfaces and imaginary future cities',
  },
  {
    id: 'AI_LAB', name: 'AI 实验室', group: 'TECHNOLOGY', description: '清洁实验室感，适合 AI 产品、模型与自动化主题', swatches: ['#F5F9FB', '#7FD0DA', '#2A67C7', '#242D3B'],
    prompt: 'Clean AI lab editorial photography; frosted white, pale cyan, precise cobalt and soft graphite; creator evaluates model outputs through physical notes, translucent material samples and gentle computational light in a realistic studio-lab workspace; sterile but warm, high clarity, accurate reflections and disciplined composition; avoid server-room cliches, humanoid robots, floating dashboards, matrix code and blue sci-fi darkness',
  },
  {
    id: 'CLEAN_ENERGY', name: '清洁能源', group: 'TECHNOLOGY', description: '明亮低碳产业感，适合新能源、制造升级与可持续', swatches: ['#F4F7F2', '#74A982', '#5D8AA8', '#D7B15C'],
    prompt: 'Clean-energy industrial editorial photography; warm white, leaf green, muted steel blue and a small brass sunlight accent; creator reviews renewable material samples, field photographs and engineering notes on a practical desk with natural daylight and subtle outdoor industrial context; optimistic but factual, tactile and grounded; avoid greenwashing symbols, stock wind-turbine collage, fake logos, dashboards and glossy corporate brochure staging',
  },
  {
    id: 'MONO_EDITORIAL', name: '黑白刊物', group: 'EDITORIAL', description: '高反差黑白，适合人物观点与深度专题', swatches: ['#F7F7F4', '#171717', '#737373', '#D8D8D2'],
    prompt: 'Modern black-and-white independent magazine photography; paper white, carbon black and layered grays; bold crop, asymmetric breathing room, natural midtones, tactile paper grain and quiet human focus; creator reviews documentary photos and notes with restrained emotional weight; avoid glossy fashion advertising, crushed shadows and decorative line clutter',
  },
  {
    id: 'NEWSPAPER_EDITORIAL', name: '现代报刊', group: 'EDITORIAL', description: '栏目与标题感强，适合时事、评论与历史', swatches: ['#F5F2EA', '#202020', '#A52D2D', '#7F8A82'],
    prompt: 'Contemporary journalistic editorial photography; soft newsprint white, ink black, muted red and gray-green; creator desk with archive photographs, clippings, field notes and a clear investigative mood; subtle offset ink texture and sober pacing; avoid fake mastheads, dense text fields, old-yellow nostalgia and sticker collage',
  },
  {
    id: 'LIFESTYLE_PHOTO', name: '生活方式摄影', group: 'EDITORIAL', description: '自然松弛，适合成长、职场与生活经验', swatches: ['#F7F4EE', '#9DB8AD', '#D7A48F', '#4B5960'],
    prompt: 'Contemporary lifestyle editorial photography; warm natural daylight, sage green, pale coral and neutral gray-blue; relaxed real workspace with daily objects, notes, camera and coffee; approachable but polished composition, tactile materials and natural visual breathing room; avoid influencer cafe staging, glossy filters and decorative objects unrelated to the work',
  },
  {
    id: 'CONSULTING_REPORT', name: '咨询报告', group: 'KNOWLEDGE', description: '结论先行，适合策略、行业与商业框架', swatches: ['#F7F8FA', '#173B73', '#5B83B4', '#D9A441'],
    prompt: 'Premium strategic editorial photography without literal business diagrams; cool white, deep navy, steel blue and restrained amber; creator organizes evidence, printed research and decision materials into a calm high-clarity desk scene; mature corporate intelligence feeling, polished lighting, precise object relationships; avoid PowerPoint aesthetics, fake numbers, stock handshake imagery and decorative dashboard screens',
  },
  {
    id: 'SCIENCE_ATLAS', name: '科普图谱', group: 'KNOWLEDGE', description: '结构准确，适合自然、医学与技术科普', swatches: ['#F5F8F7', '#2D6B66', '#85B8A5', '#E3A55B'],
    prompt: 'Modern science-atlas editorial illustration; clean pale gray-white field, deep teal, botanical green and small orange accents; creator workspace where research objects, material samples, photographs and magnified textures feel accurate and carefully observed; refined natural drawing texture with clear subject hierarchy; avoid fake formulas, tiny unreadable annotations and childish textbook style',
  },
  {
    id: 'PENCIL_SKETCH', name: '铅笔线稿', group: 'ILLUSTRATION', description: '轻巧克制，适合思考、教程与人物故事', swatches: ['#FAF8F2', '#353A40', '#9AA6A0', '#D68A78'],
    prompt: 'Elegant pencil sketch editorial artwork; warm white sketch paper, graphite gray, muted sage and tiny dusty coral accents; creator sorting research materials with sensitive line weight, hatching, erased construction marks and mature design-process feeling; clear focal subject and calm hand-made texture; avoid messy handwriting, cartoon faces and mechanical outline tracing',
  },
  {
    id: 'WOODCUT_PRINT', name: '木刻版画', group: 'CULTURAL', description: '粗粝有力，适合历史、民俗与人物主题', swatches: ['#F2EBDD', '#1F2724', '#B63C31', '#315F61'],
    prompt: 'Contemporary woodcut print editorial image; rice-white paper, deep ink black, brick red and peacock teal; creator workspace carved through strong blocks, visible knife marks, limited overprint color and tactile paper pressure; focused human scene with real subject matter and powerful silhouette; avoid tourist folklore patterns, antique yellow wash and theatrical gore',
  },
  {
    id: 'INDUSTRIAL_MEDIA', name: '工业纪实', group: 'TECHNOLOGY', description: '真实硬朗，适合制造、汽车与产业现场', swatches: ['#EEF1F2', '#39464F', '#6F8F93', '#E18B47'],
    prompt: 'Modern industrial documentary media photography; cool gray, steel blue, desaturated cyan-gray and a small safety orange accent; creator reviews factory photos, material samples and field notes on a robust desk; clear scale, practical light and sharp equipment detail; avoid sci-fi factories, empty showroom drama, fake brand marks, blue neon and HDR propaganda sheen',
  },
  {
    id: 'MACARON_CARTOON', name: '马卡龙卡通', group: 'ILLUSTRATION', description: '轻松亲和，适合生活方式、工具教程与小红书图文', swatches: ['#FFF9F2', '#A8DDE0', '#F5B8CA', '#F4D56A'],
    prompt: '精致的成人编辑卡通；珍珠白、低饱和薄荷青、樱花粉与柔和奶油黄；创作者人物表情自然，桌面物件简化但准确，线条自信，前中后层次清楚，圆润造型保持克制，呈现高级杂志插画质感',
  },
  {
    id: 'PIXEL_RETRO', name: '像素复古', group: 'ILLUSTRATION', description: '像素叙事与现代排版，适合科技、游戏、历史回看与轻科普', swatches: ['#F5F0E8', '#345995', '#E86A5A', '#58A88A'],
    prompt: '现代编辑型像素艺术；暖白、钴蓝、莓红与青绿的有限色板；用清晰而有意图的像素簇表现连贯创作者场景，人物动作和空间深度明确，局部细节精确，整体构图当代而完整，不出现游戏界面或版权角色',
  },
  {
    id: 'CYBER_TECH', name: '清透赛博', group: 'TECHNOLOGY', description: '高对比数字空间，适合前沿科技、未来产业与数字文化', swatches: ['#0B1020', '#20D9D2', '#F24F8A', '#E8F4FF'],
    prompt: '明亮克制的赛博编辑摄影；石墨灰与冷白为主，电光青配极少玫红；透明光学材质和精确光路自然融入真实人物工作场景，面部与物件细节清楚，技术氛围优雅，不用代码雨、廉价 HUD 或过暗霓虹',
  },
];

const styleCases = {
  FRESH_EDITORIAL: { caseLabel: '人物专题', caseTitle: '把复杂的事，说得清楚一点', caseMeta: '照片主导 · 非对称留白' },
  BUSINESS_EDITORIAL: { caseLabel: '行业观察', caseTitle: '市场正在进入新的增长周期', caseMeta: '数据与照片 · 稳定网格' },
  SWISS_GRID: { caseLabel: '观点封面', caseTitle: '重新理解效率', caseMeta: '强对比 · 模数网格' },
  DOCUMENTARY: { caseLabel: '现场记录', caseTitle: '真实工作的一天', caseMeta: '环境人物 · 自然光' },
  CINEMATIC_DOCUMENTARY: { caseLabel: '人物故事', caseTitle: '那些没有被看见的选择', caseMeta: '宽银幕 · 叙事光影' },
  MONO_EDITORIAL: { caseLabel: '深度访谈', caseTitle: '保持判断，比追赶更重要', caseMeta: '黑白影像 · 大胆裁切' },
  NEWSPAPER_EDITORIAL: { caseLabel: '时事评论', caseTitle: '今天，我们如何理解变化', caseMeta: '报刊栏目 · 资料编排' },
  LIFESTYLE_PHOTO: { caseLabel: '个人成长', caseTitle: '慢一点，也能把事情做好', caseMeta: '日常场景 · 自然留白' },
  MINIMAL_KNOWLEDGE: { caseLabel: '方法拆解', caseTitle: '三步建立自己的内容系统', caseMeta: '模块卡片 · 结论优先' },
  DATA_VISUAL: { caseLabel: '数据解读', caseTitle: '一张图看懂五年变化', caseMeta: '趋势对比 · 数据语义' },
  BLUEPRINT_DIAGRAM: { caseLabel: '原理图解', caseTitle: '一个智能体是怎样工作的', caseMeta: '结构连线 · 工程视角' },
  HAND_DRAWN_NOTES: { caseLabel: '读书笔记', caseTitle: '真正有用的五个方法', caseMeta: '圈注箭头 · 纸张质感' },
  CONSULTING_REPORT: { caseLabel: '策略框架', caseTitle: '增长机会与行动路径', caseMeta: '结论先行 · 矩阵框架' },
  SCIENCE_ATLAS: { caseLabel: '科学解释', caseTitle: '大模型如何理解一句话', caseMeta: '剖面放大 · 编号引线' },
  RETRO_POP: { caseLabel: '清新科普', caseTitle: 'AI 工具也可以很好玩', caseMeta: '丝网网点 · 马卡龙套色' },
  PAPER_COLLAGE: { caseLabel: '人文观察', caseTitle: '记忆是怎样被保存的', caseMeta: '照片裁片 · 撕纸层次' },
  FLAT_GEOMETRIC: { caseLabel: '概念解释', caseTitle: '人与工具的新关系', caseMeta: '几何人物 · 清晰关系' },
  SOFT_3D: { caseLabel: '产品主视觉', caseTitle: '让想法变成看得见的东西', caseMeta: '哑光体积 · 柔和光影' },
  PENCIL_SKETCH: { caseLabel: '思考手稿', caseTitle: '一个创意是怎样长出来的', caseMeta: '石墨线条 · 局部排线' },
  NEW_CHINESE: { caseLabel: '文化专题', caseTitle: '古人的时间观', caseMeta: '东方留白 · 现代网格' },
  INK_WASH: { caseLabel: '哲思随笔', caseTitle: '留白，也是一种表达', caseMeta: '轻墨层次 · 朱红落点' },
  GUOCHAO_POSTER: { caseLabel: '历史封面', caseTitle: '从一件器物看见时代', caseMeta: '大胆裁切 · 现代套色' },
  MINERAL_FRESCO: { caseLabel: '非遗观察', caseTitle: '颜色里保存着手艺的时间', caseMeta: '矿物色层 · 壁画质感' },
  WOODCUT_PRINT: { caseLabel: '民俗人物', caseTitle: '土地上生长出的故事', caseMeta: '刀痕块面 · 有限套色' },
  TECH_MEDIA: { caseLabel: '前沿科技', caseTitle: '智能体正在重写工作流', caseMeta: '结构数据 · 明亮冷静' },
  AI_LAB: { caseLabel: '模型实验', caseTitle: '让模型输出变得可验证', caseMeta: '透明材料 · 精准冷光' },
  CLEAN_ENERGY: { caseLabel: '低碳产业', caseTitle: '新的效率来自更干净的系统', caseMeta: '自然光线 · 工业样本' },
  INDUSTRIAL_MEDIA: { caseLabel: '产业现场', caseTitle: '制造业里的新效率', caseMeta: '真实设备 · 工业尺度' },
  MACARON_CARTOON: { caseLabel: '轻松教程', caseTitle: '每天十分钟，整理自己的信息流', caseMeta: '亲和人物 · 清新套色' },
  PIXEL_RETRO: { caseLabel: '科技回看', caseTitle: '从工具箱到智能工作流', caseMeta: '像素叙事 · 现代网格' },
  CYBER_TECH: { caseLabel: '数字前沿', caseTitle: '智能体如何协同完成工作', caseMeta: '透明界面 · 电光强调' },
};

const featuredStylePreviews = {
  FRESH_EDITORIAL: '/visual-style-previews/fresh-editorial.png',
  BUSINESS_EDITORIAL: '/visual-style-previews/business-editorial.png',
  RETRO_POP: '/visual-style-previews/retro-pop.png',
  MACARON_CARTOON: '/visual-style-previews/macaron-cartoon.png',
  SOFT_3D: '/visual-style-previews/soft-3d.png',
  MINIMAL_KNOWLEDGE: '/visual-style-previews/minimal-knowledge.png',
  SWISS_GRID: '/visual-style-previews/swiss-grid.png',
  CYBER_TECH: '/visual-style-previews/cyber-tech.png',
  PIXEL_RETRO: '/visual-style-previews/pixel-retro.png',
  PAPER_COLLAGE: '/visual-style-previews/paper-collage.png',
  HAND_DRAWN_NOTES: '/visual-style-previews/hand-drawn-notes.png',
  NEW_CHINESE: '/visual-style-previews/new-chinese.png',
  INK_WASH: '/visual-style-previews/ink-wash.png',
  GUOCHAO_POSTER: '/visual-style-previews/guochao-poster.png',
  MINERAL_FRESCO: '/visual-style-previews/mineral-fresco.png',
  DATA_VISUAL: '/visual-style-previews/data-visual.png',
  CINEMATIC_DOCUMENTARY: '/visual-style-previews/cinematic-documentary.png',
  MONO_EDITORIAL: '/visual-style-previews/mono-editorial.png',
  NEWSPAPER_EDITORIAL: '/visual-style-previews/newspaper-editorial.png',
  LIFESTYLE_PHOTO: '/visual-style-previews/lifestyle-photo.png',
  CONSULTING_REPORT: '/visual-style-previews/consulting-report.png',
  SCIENCE_ATLAS: '/visual-style-previews/science-atlas.png',
  FLAT_GEOMETRIC: '/visual-style-previews/flat-geometric.png',
  PENCIL_SKETCH: '/visual-style-previews/pencil-sketch.png',
  WOODCUT_PRINT: '/visual-style-previews/woodcut-print.png',
  TECH_MEDIA: '/visual-style-previews/tech-media.png',
  AI_LAB: '/visual-style-previews/ai-lab.png',
  CLEAN_ENERGY: '/visual-style-previews/clean-energy.png',
  INDUSTRIAL_MEDIA: '/visual-style-previews/industrial-media.png',
};

const visualTemplates = {
  NEWS_PHOTO: [{ id: 'EDITORIAL_CROP', name: '编辑裁切', prompt: '编辑式主体裁切，保留标题安全区' }],
  HERO_VISUAL: [{ id: 'SUBJECT_FOCUS', name: '主体聚焦', prompt: '单一主体聚焦，背景克制，视觉中心明确' }],
  SCENE: [
    { id: 'WIDE_CONTEXT', name: '环境叙事', prompt: '用完整环境交代人物、动作和使用情境' },
    { id: 'CLOSE_ACTION', name: '动作特写', prompt: '聚焦手部、工具或关键动作，背景只保留必要信息' },
  ],
  CONCEPT_DIAGRAM: [{ id: 'RELATION_NETWORK', name: '关系网络', prompt: '中心概念与关联对象通过清晰连线组成关系网络' }],
  MIND_MAP: [
    { id: 'RADIAL_BRANCH', name: '放射分支', prompt: '中心主题向四周展开一级分支，分支层级清晰' },
    { id: 'TREE_BRANCH', name: '树状分支', prompt: '从上到下的树状层级，父子关系明确' },
  ],
  FLOWCHART: [
    { id: 'VERTICAL_STEPS', name: '纵向步骤', prompt: '步骤自上而下排列，用箭头连接，适合手机阅读' },
    { id: 'HORIZONTAL_PROCESS', name: '横向流程', prompt: '步骤从左到右推进，阶段边界清楚' },
  ],
  TIMELINE: [{ id: 'HORIZONTAL_TIMELINE', name: '横向时间线', prompt: '时间节点从左到右排列，年份与事件一一对应' }],
  COMPARISON: [{ id: 'SPLIT_COMPARE', name: '左右对比', prompt: '左右两栏使用相同信息层级，对比项逐行对齐' }],
  DATA_CHART: [{ id: 'EDITORIAL_CHART', name: '编辑图表', prompt: '使用与数据关系匹配的简洁图表，标注单位与来源位置' }],
  QUOTE_CARD: [{ id: 'QUOTE_FOCUS', name: '观点聚焦', prompt: '引语为视觉中心，出处紧邻引语且层级更低' }],
  INFO_CARD: [{ id: 'MODULAR_SUMMARY', name: '模块摘要', prompt: '结论优先，信息点分成独立模块并按阅读顺序排列' }],
  CHECKLIST_CARD: [{ id: 'NUMBERED_CHECKLIST', name: '编号清单', prompt: '行动项使用醒目编号，逐项对齐并保留勾选视觉' }],
};

export function visualStylePresets() {
  return stylePresets.map((item) => ({
    ...item,
    ...styleCases[item.id],
    previewImage: featuredStylePreviews[item.id] ?? null,
    featured: Boolean(featuredStylePreviews[item.id]),
    swatches: [...item.swatches],
  }));
}

export function visualTemplatesFor(type) {
  return (visualTemplates[type] ?? visualTemplates.SCENE).map((item) => ({ ...item }));
}

function clean(value) {
  return String(value ?? '').replace(/[#>*_`~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function conceptsFrom(value) {
  const text = clean(value);
  return unique([
    ...commonConcepts.filter((concept) => text.toLowerCase().includes(concept.toLowerCase())),
    ...semanticConceptRules.filter(([pattern]) => pattern.test(text)).map(([, concept]) => concept),
  ]);
}

function subjectFromTitle(title) {
  const headline = clean(title).split(/[：:｜|]/)[0].replace(/[，。！？,.!?]+$/g, '');
  const stripped = headline
    .replace(/^(我国|中国)?(?:成功|正式|首次|最新)?(?:完成|实现|发布|推出|发射|上线|宣布|启动|举行)/, '')
    .replace(/(?:成功)?(?:发射|发布|推出|上线|启动|建成|开放|收购|突破|上映)(?:成功)?$/, '')
    .trim();
  return (stripped.length >= 3 ? stripped : headline).slice(0, 24);
}

function termsFrom(value, limit = 6) {
  const text = clean(value);
  const quoted = [...text.matchAll(/[《“「『](.{2,18}?)[》”」』]/g)].map((match) => match[1]);
  const technical = text.match(/[A-Za-z][A-Za-z0-9+_.-]{1,24}|[\u4e00-\u9fff]{2,8}\d{1,4}[\u4e00-\u9fff]{0,2}/g) ?? [];
  const segmented = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    for (const item of segmenter.segment(text)) {
      const word = clean(item.segment);
      if (item.isWordLike && word.length >= 2 && word.length <= 12) segmented.push(word);
    }
  }
  const candidates = unique([...conceptsFrom(text), ...quoted, ...technical, ...segmented])
    .filter((word) => !stopWords.has(word) && !/^\d+$/.test(word) && !/[，。！？；：,.!?;:]/.test(word));
  return candidates
    .filter((word) => word.length > 4 || !candidates.some((other) => other !== word && other.length > word.length && other.includes(word)))
    .sort((left, right) => conceptsFrom(text).includes(left) === conceptsFrom(text).includes(right) ? right.length - left.length : conceptsFrom(text).includes(left) ? -1 : 1)
    .slice(0, limit);
}

function contentSections(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const sections = [];
  let heading = '';
  let paragraph = [];
  const flush = () => {
    const text = clean([...heading ? [heading] : [], ...paragraph].join(' '));
    if (text.length >= 12) sections.push(text);
    heading = '';
    paragraph = [];
  };
  for (const rawLine of lines) {
    const line = clean(rawLine.replace(/^#{1,6}\s*/, ''));
    if (!line) { flush(); continue; }
    const isHeading = rawLine.trim().startsWith('#') || (line.length <= 26 && !/[。！？]$/.test(line));
    if (isHeading && paragraph.length) flush();
    if (isHeading) heading = line;
    else paragraph.push(line);
  }
  flush();
  return unique(sections);
}

function bodyCandidates(body, subject, coreMessage) {
  const sections = contentSections(body);
  const clauses = sections.flatMap((section) => section.split(/[。！？；]/).map(clean).filter((item) => item.length >= 12));
  return unique([...sections, ...clauses, coreMessage, subject]);
}

export function visualImageSize(platform, role) {
  if (platform === 'XIAOHONGSHU') return '3:4';
  if (platform === 'WEIBO') return '1:1';
  if (role === 'BODY') return '4:3';
  return '16:9';
}

function visualStyle(platform, role) {
  if (platform === 'XIAOHONGSHU') return role === 'COVER'
    ? '清爽的小红书封面视觉，主体明确，构图有记忆点，顶部和中部保留后期标题区域'
    : '清爽的知识图文卡片视觉，单页只表达一个重点，层级清楚，保留后期排字区域';
  if (platform === 'WEIBO') return '适合微博信息流的方形主视觉，主体突出，缩略图状态仍容易识别';
  if (role === 'COVER') return '克制的中文媒体封面风格，主体突出，横向构图，左侧或上方保留标题区域';
  return '克制的中文媒体正文插图风格，画面服务当前段落，不重复封面画面';
}

function stylePrompt(stylePreset, styleProfile = { preset: 'FRESH_EDITORIAL' }) {
  const resolved = stylePreset && stylePreset !== 'INHERIT' ? stylePreset : styleProfile?.preset ?? 'FRESH_EDITORIAL';
  const presetPrompt = stylePresets.find((item) => item.id === resolved)?.prompt ?? stylePresets[0].prompt;
  const customPrompt = clean(styleProfile?.customPrompt).slice(0, 1_200);
  return customPrompt ? `${presetPrompt}；项目统一补充要求：${customPrompt}` : presetPrompt;
}

function projectContinuityPrompt(stylePreset, styleProfile) {
  const resolved = stylePreset && stylePreset !== 'INHERIT' ? stylePreset : styleProfile?.preset ?? 'FRESH_EDITORIAL';
  const name = stylePresets.find((item) => item.id === resolved)?.name ?? stylePresets[0].name;
  return `本图属于同一项目的“${name}”视觉系列，必须与项目其他图片保持一致的主色比例、光线方向、材质处理、镜头气质和细节完成度；只改变当前段落要求的主体与场景，不自行混入其他艺术风格`;
}

function templateFor(type, templatePreset) {
  const templates = visualTemplatesFor(type);
  return templates.find((item) => item.id === templatePreset) ?? templates[0];
}

function visualTypeFor(section, role, platform) {
  if (role === 'COVER' || role === 'MAIN') return /发射|发布|启动|开幕|获奖|夺冠|上映/.test(section) ? 'NEWS_PHOTO' : 'SCENE';
  const years = section.match(/(?:19|20)\d{2}\s*年?/g) ?? [];
  if (years.length >= 2) return 'TIMELINE';
  if (/对比|相比|前者|后者|传统.+(?:新|智能)|(?:方案|方式)\s*[ABＡＢ]/i.test(section)) return 'COMPARISON';
  if (/步骤|流程|路径|第一步|先.+(?:再|然后).+(?:最后|最终)/.test(section)) return 'FLOWCHART';
  if (/组成|分为|分类|体系|模块.+构成|包括.+(?:以及|和|、)/.test(section)) return 'MIND_MAP';
  if (/\d+(?:\.\d+)?(?:%|万|亿|元|倍|人|家|项)|同比|环比/.test(section)) return 'DATA_CHART';
  if (/原理|机制|关系|流程|链路|中继|测控|组网|覆盖/.test(section)) return 'CONCEPT_DIAGRAM';
  if (/引述|表示|认为|说[:：]/.test(section)) return 'QUOTE_CARD';
  if (/清单|要点|注意事项|检查项/.test(section)) return 'CHECKLIST_CARD';
  if (platform === 'XIAOHONGSHU') return 'INFO_CARD';
  return 'SCENE';
}

function defaultGenerationMode(role, visualType) {
  return role === 'CARD' || ['FLOWCHART', 'TIMELINE', 'COMPARISON', 'DATA_CHART', 'QUOTE_CARD', 'INFO_CARD', 'CHECKLIST_CARD'].includes(visualType) ? 'INFOGRAPHIC' : 'ILLUSTRATION';
}

function informationPointsFor(section, focus, purpose) {
  const clauses = clean(section).split(/[。！？；]/).map(clean).filter((item) => item.length >= 6).map((item) => item.slice(0, 72));
  const focusPoints = clean(focus).split(/[、，]/).map(clean).filter(Boolean).map((item) => `重点理解：${item}`);
  return unique([...clauses, ...focusPoints, clean(purpose)]).slice(0, 5);
}

function contentBlocksFor(type, section, focus, purpose) {
  const text = clean(section);
  const clauses = unique(text.split(/[。！？；]/).flatMap((part) => part.split(/(?:，|、|：)/)).map(clean).filter((item) => item.length >= 2 && item.length <= 88));
  if (type === 'TIMELINE') {
    const events = [...text.matchAll(/((?:19|20)\d{2})\s*年?([^，。；]*)/g)].map((match) => ({ label: match[1], detail: clean(match[2]) || '阶段节点' }));
    if (events.length >= 2) return events.slice(0, 6);
  }
  if (type === 'COMPARISON') {
    const sides = text.split(/[；。]/).map(clean).filter(Boolean);
    if (sides.length >= 2) return sides.slice(0, 2).map((detail, index) => ({ label: index ? '方案 B' : '方案 A', detail }));
    const beforeAfter = text.split(/(?:前者|后者)/).map(clean).filter(Boolean);
    if (beforeAfter.length >= 2) return beforeAfter.slice(-2).map((detail, index) => ({ label: index ? '方案 B' : '方案 A', detail }));
  }
  if (type === 'MIND_MAP') {
    const branches = unique([...conceptsFrom(text), ...termsFrom(text, 8), ...clauses]).slice(0, 5);
    return [{ label: '中心主题', detail: clean(focus) }, ...branches.map((detail, index) => ({ label: `分支 ${index + 1}`, detail }))].slice(0, 6);
  }
  if (type === 'FLOWCHART' || type === 'CHECKLIST_CARD') {
    const normalized = text.replace(/(?:第一步|首先|先)/g, '§').replace(/(?:第二步|其次|再)/g, '§').replace(/(?:第三步|然后|接着)/g, '§').replace(/(?:第四步|最后|最终)/g, '§');
    const steps = unique(normalized.split('§').map(clean).filter((item) => item.length >= 2));
    const values = steps.length >= 2 ? steps : clauses;
    return values.slice(0, 6).map((detail, index) => ({ label: `步骤 ${index + 1}`, detail }));
  }
  const points = informationPointsFor(text, focus, purpose);
  return points.map((detail, index) => ({ label: `要点 ${index + 1}`, detail }));
}

function referenceInstruction(references = []) {
  if (!references.length) return '';
  const labels = { COLOR: '色彩', COMPOSITION: '构图', LAYOUT: '排版', TEXTURE: '质感', SUBJECT: '人物或主体特征' };
  const uses = unique(references.flatMap((item) => item.uses ?? []).map((use) => labels[use] ?? ''));
  return uses.length ? `参考图只用于参考${uses.join('、')}，不要照搬其中的文字、标识或完整画面。` : '';
}

function structureInstruction(item) {
  const blocks = (item.contentBlocks ?? []).filter((block) => clean(block.label) && clean(block.detail));
  if (!blocks.length) return '';
  return `结构内容：${blocks.map((block) => `${clean(block.label)}：${clean(block.detail)}`).join('；')}。`;
}

function infographicStyle(platform) {
  if (platform === 'XIAOHONGSHU') return '3:4 竖版视觉图解，主画面占主要面积，少量短标签贴近对应对象，四周留出安全边距';
  if (platform === 'WEIBO') return '1:1 方形视觉图解，核心对象在缩略图状态仍可辨认，关系节点不超过四组';
  if (platform === 'ZHIHU') return '4:3 横版视觉图解，理性克制，以对象和关系为主，适合正文阅读';
  return '公众号正文横版视觉图解，主画面清楚，关系一眼可辨，少量标签辅助理解并保留充足留白';
}

export function buildVisualGenerationSpec(item, context, mode = item.generationMode ?? defaultGenerationMode(item.role, item.visualType), styleProfile = { preset: 'FRESH_EDITORIAL' }) {
  const platform = context.platform;
  const title = clean(context.title) || '未命名内容';
  const platformLabel = platformLabels[platform] ?? '图文平台';
  const roleLabel = item.role === 'COVER' ? '封面' : item.role === 'CARD' ? '图文卡片' : item.role === 'MAIN' ? '主图' : '正文插图';
  const avoid = item.avoidConcepts.length ? `不要重复表现：${item.avoidConcepts.join('、')}。` : '';
  const style = stylePrompt(item.stylePreset, styleProfile);
  const continuity = projectContinuityPrompt(item.stylePreset, styleProfile);
  const template = templateFor(item.visualType, item.templatePreset);
  const structure = structureInstruction(item);
  const reference = referenceInstruction(item.references);
  if (mode === 'INFOGRAPHIC') {
    const headline = item.role === 'COVER' || item.role === 'MAIN' ? title : clean(item.focus).replace(/、/g, '与');
    const labels = (item.contentBlocks ?? []).map((block) => clean(block.label)).filter(Boolean).slice(0, 4);
    const labelText = labels.join('、');
    return {
      generationMode: mode,
      prompt: `为${platformLabel}内容《${title}》制作一张${roleLabel}${visualTypeLabels[item.visualType]}。画面内容优先：${item.focus}。用图形、对象、空间关系、时间顺序或数据形态直接讲清楚“${item.purpose}”，不要做成文字型 PPT、课程卡片或大段文字海报。项目统一视觉方向：${style}。系列一致性：${continuity}。构图参考：${template.prompt}。${structure}图内文字必须极少：${item.role === 'COVER' || item.role === 'MAIN' || item.role === 'CARD' ? `只允许一个短标题“${headline}”` : '不要文章标题'}${labelText ? `，以及必要短标签“${labelText}”` : ''}；不生成正文段落、解释句、序号清单或装饰性文字。平台版式：${infographicStyle(platform)}。${reference}${avoid}不得出现错别字、乱码、文字变形、水印、Logo、二维码；不得自行添加数据、机构、人物引语或未经正文支持的结论。`,
    };
  }
  return {
    generationMode: mode,
    prompt: `为${platformLabel}内容《${title}》制作一张${roleLabel}${visualTypeLabels[item.visualType]}。画面主体：${item.focus}。先表现可见的主体、动作、环境和关键关系，让读者不看文字也能理解“${item.purpose}”。项目统一视觉方向：${style}。系列一致性：${continuity}。构图参考：${template.prompt}。${visualStyle(platform, item.role)}。${reference}${avoid}图片内容必须占主导，不做文字型 PPT、信息卡片或大段文字海报；只生成视觉素材，不在图片内生成文字、Logo、二维码或水印。画面真实、准确、干净，细节清晰；涉及新闻事件时采用概念视觉，不伪造新闻现场，不虚构具体机构标识。`,
  };
}

export function updateVisualPlanItem(item, patch, context, styleProfile = { preset: 'FRESH_EDITORIAL' }) {
  const visualType = patch.visualType ?? item.visualType;
  const typeChanged = patch.visualType && patch.visualType !== item.visualType;
  const next = {
    ...item,
    ...patch,
    visualType,
    generationMode: patch.generationMode ?? (typeChanged ? defaultGenerationMode(item.role, visualType) : item.generationMode),
    stylePreset: patch.stylePreset ?? item.stylePreset ?? 'INHERIT',
    templatePreset: patch.templatePreset ?? (typeChanged ? visualTemplatesFor(visualType)[0].id : item.templatePreset ?? visualTemplatesFor(visualType)[0].id),
    sourceExcerpt: patch.sourceExcerpt ?? item.sourceExcerpt ?? '',
    contentBlocks: patch.contentBlocks ?? item.contentBlocks ?? contentBlocksFor(visualType, item.sourceExcerpt ?? item.purpose, item.focus, item.purpose),
    references: patch.references ?? item.references ?? [],
    size: visualImageSize(context.platform, item.role),
  };
  delete next.negativePrompt;
  return { ...next, ...buildVisualGenerationSpec(next, context, next.generationMode, styleProfile) };
}

function searchQueriesFor({ title, focus, category, role, visualType }) {
  const subject = subjectFromTitle(title);
  const focusTerms = termsFrom(focus, 8).filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const titleTerms = termsFrom(title, 6).filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const action = title.match(/发射|发布|推出|上线|启动|建成|开放|收购|增长|下降|突破|获奖|夺冠|上映/)?.[0];
  const location = /^(我国|中国)/.test(clean(title)) ? '中国' : '';
  if (role === 'COVER' || role === 'MAIN') {
    return unique([
      unique([subject, action ?? '']).slice(0, 2).join(' '),
      unique([location, subject, ...titleTerms]).slice(0, 3).join(' '),
      unique([category, subject, '主题图片']).slice(0, 3).join(' '),
    ]).filter((query) => query.length >= 2 && query.length <= 60).slice(0, 3);
  }
  const sceneHint = visualType === 'NEWS_PHOTO' ? '新闻现场' : visualType === 'SCENE' ? '真实场景' : visualType === 'HERO_VISUAL' ? '主体实拍' : '现场照片';
  const primaryTerms = unique([subject, ...focusTerms]).slice(0, 3);
  return unique([
    primaryTerms.join(' '),
    unique([subject, focusTerms[0], sceneHint]).slice(0, 3).join(' '),
    unique([subject, category, focusTerms[1] || action || '']).slice(0, 3).join(' '),
  ]).filter((query) => query.length >= 2 && query.length <= 60).slice(0, 3);
}

export function visualPlanCountRange(platform) {
  if (platform === 'WEIBO') return { min: 1, max: 9 };
  if (platform === 'XIAOHONGSHU') return { min: 5, max: 8 };
  if (platform === 'ZHIHU') return { min: 2, max: 11 };
  return { min: 2, max: 11 };
}

function desiredItemCount(platform, body, requestedBodyItemCount) {
  const length = clean(body).length;
  const range = visualPlanCountRange(platform);
  const recommended = platform === 'WEIBO'
    ? 1
    : platform === 'XIAOHONGSHU'
      ? 5 + Math.floor(length / 900)
      : 2 + Math.floor(length / 1200);
  const requested = Number.isFinite(requestedBodyItemCount) ? Math.round(requestedBodyItemCount) : recommended;
  const bodyItemCount = Math.max(range.min, Math.min(range.max, requested));
  return platform === 'WEIBO' ? bodyItemCount : bodyItemCount + 1;
}

function focusFor(section, subject, usedConcepts, index) {
  const candidates = unique([...conceptsFrom(section), ...termsFrom(section, 8)])
    .filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const fresh = candidates.filter((term) => !usedConcepts.has(term));
  const selected = (fresh.length ? fresh : usedConcepts.size ? [] : candidates).slice(0, 3);
  if (selected.length) return selected.join('、');
  return unique([subject, ['工作原理', '应用场景', '影响关系', '发展趋势'][index % 4]]).join('、');
}

export function buildVisualPlan(input, platform, options = {}) {
  const title = clean(input?.title) || '未命名内容';
  const body = String(input?.body ?? '');
  const category = clean(input?.category);
  const coreMessage = clean(input?.coreMessage);
  const subject = subjectFromTitle(title);
  const count = desiredItemCount(platform, body, options.bodyItemCount);
  const plan = [];
  const coverRole = platform === 'WEIBO' ? 'MAIN' : 'COVER';
  const coverPurpose = platform === 'WEIBO' ? '在信息流中快速传达主题并吸引点击' : '概括全文主题并承担首屏识别';
  const coverFocus = unique([subject, ...conceptsFrom(coreMessage), ...termsFrom(coreMessage, 2)]).slice(0, 3).join('、') || subject;
  const coverType = visualTypeFor(title, coverRole, platform);
  const coverQueries = searchQueriesFor({ title, focus: coverFocus, category, role: coverRole, visualType: coverType });
  const coverPurposePoints = informationPointsFor(coreMessage || title, coverFocus, coverPurpose);
  const coverItem = {
    id: `${platform.toLowerCase()}-cover`, role: coverRole,
    title: coverRole === 'MAIN' ? '微博主图' : '文章封面', placement: '发布首图', purpose: coverPurpose,
    visualType: coverType, focus: coverFocus, avoidConcepts: [], searchQueries: coverQueries,
    generationMode: defaultGenerationMode(coverRole, coverType), informationPoints: coverPurposePoints,
    stylePreset: 'INHERIT', templatePreset: visualTemplatesFor(coverType)[0].id,
    sourceExcerpt: clean(coreMessage || title), contentBlocks: contentBlocksFor(coverType, coreMessage || title, coverFocus, coverPurpose), references: [],
    size: visualImageSize(platform, coverRole), assetId: null,
  };
  plan.push({ ...coverItem, ...buildVisualGenerationSpec(coverItem, { platform, title }) });

  const candidates = bodyCandidates(body, subject, coreMessage);
  const usedConcepts = new Set();
  const usedPrimaryQueries = new Set(coverQueries.slice(0, 1));
  for (let index = 1; index < count; index += 1) {
    const role = platform === 'XIAOHONGSHU' ? 'CARD' : 'BODY';
    const section = candidates[Math.min(index - 1, Math.max(0, candidates.length - 1))] || coreMessage || subject;
    const focus = focusFor(section, subject, usedConcepts, index - 1);
    termsFrom(focus, 4).forEach((term) => usedConcepts.add(term));
    const visualType = visualTypeFor(section, role, platform);
    const avoidConcepts = unique([
      /发射|火箭/.test(title) ? '火箭发射现场' : '',
      ...Array.from(usedConcepts).filter((concept) => !focus.includes(concept)).slice(-2),
    ]);
    let searchQueries = searchQueriesFor({ title, focus, category, role, visualType });
    const freshQueries = searchQueries.filter((query) => !usedPrimaryQueries.has(query));
    if (freshQueries.length) searchQueries = [...freshQueries, ...searchQueries.filter((query) => !freshQueries.includes(query))];
    if (searchQueries[0]) usedPrimaryQueries.add(searchQueries[0]);
    const placement = platform === 'XIAOHONGSHU' ? `第 ${index + 1} 页` : `正文第 ${index} 个核心段落后`;
    const purpose = platform === 'XIAOHONGSHU' ? `把“${focus}”拆成一页可快速理解的视觉信息` : `解释“${focus}”，帮助读者理解这一段内容`;
    const informationPoints = informationPointsFor(section, focus, purpose);
    const item = {
      id: `${platform.toLowerCase()}-${role.toLowerCase()}-${index}`, role,
      title: platform === 'XIAOHONGSHU' ? `图文卡片 ${index}` : `正文插图 ${index}`,
      placement, purpose, visualType, focus, avoidConcepts, searchQueries,
      generationMode: defaultGenerationMode(role, visualType), informationPoints,
      stylePreset: 'INHERIT', templatePreset: visualTemplatesFor(visualType)[0].id,
      sourceExcerpt: clean(section), contentBlocks: contentBlocksFor(visualType, section, focus, purpose), references: [],
      size: visualImageSize(platform, role), assetId: null,
    };
    plan.push({ ...item, ...buildVisualGenerationSpec(item, { platform, title }) });
  }
  return plan;
}

export function replanVisualPlan(input, platform, current = [], options = {}) {
  const generated = buildVisualPlan(input, platform, options).map((item) => updateVisualPlanItem(
    item,
    {},
    { platform, title: clean(input?.title) || '未命名内容' },
    options.styleProfile ?? { preset: 'FRESH_EDITORIAL' },
  ));
  const currentById = new Map((Array.isArray(current) ? current : []).map((item) => [item.id, item]));
  const keepAssignedAssets = options.keepAssignedAssets !== false;
  return generated.map((item) => {
    const previous = currentById.get(item.id);
    const isCover = item.role === 'COVER' || item.role === 'MAIN';
    return {
      ...item,
      assetId: isCover || keepAssignedAssets ? previous?.assetId ?? null : null,
    };
  });
}

export function mergeVisualPlan(generated, persisted, persistedVersion = 0) {
  if (Array.isArray(persisted) && persistedVersion >= VISUAL_PLAN_VERSION) return persisted;
  if (Array.isArray(persisted) && persistedVersion >= 3) {
    const persistedById = new Map(persisted.map((item) => [item.id, item]));
    return generated.map((item) => {
      const previous = persistedById.get(item.id);
      if (!previous) return item;
      const merged = {
        ...item,
        purpose: previous.purpose ?? item.purpose,
        focus: previous.focus ?? item.focus,
        avoidConcepts: previous.avoidConcepts ?? item.avoidConcepts,
        searchQueries: previous.searchQueries ?? item.searchQueries,
        informationPoints: previous.informationPoints ?? item.informationPoints,
        size: previous.size ?? item.size,
        assetId: previous.assetId ?? null,
      };
      return updateVisualPlanItem(merged, {}, { platform: item.id.split('-')[0].toUpperCase(), title: generated[0]?.sourceExcerpt || generated[0]?.focus || '未命名内容' });
    });
  }
  if (Array.isArray(persisted) && persistedVersion >= 2) {
    const persistedById = new Map(persisted.map((item) => [item.id, item]));
    return generated.map((item) => {
      const previous = persistedById.get(item.id);
      return previous ? { ...item, size: previous.size ?? item.size, assetId: previous.assetId ?? null } : item;
    });
  }
  const coverId = Array.isArray(persisted)
    ? persisted.find((item) => item.role === 'COVER' || item.role === 'MAIN')?.assetId ?? null
    : null;
  return generated.map((item) => ({
    ...item,
    assetId: item.role === 'COVER' || item.role === 'MAIN' ? coverId : null,
  }));
}

export function resizeVisualPlan(generated, current = []) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return generated.map((item) => currentById.get(item.id) ?? item);
}
