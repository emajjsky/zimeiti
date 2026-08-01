export const VISUAL_PLAN_VERSION = 7;

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
    prompt: '清新中文杂志编辑风格；珍珠白底，雾蓝、浅珊瑚粉与少量深海军蓝；自然光或柔和棚拍光；非对称编辑构图，大面积留白，主体与信息层级分明；纸张轻纹理，边缘干净；避免奶油黄滤镜、廉价素材拼贴和过度装饰',
  },
  {
    id: 'BUSINESS_EDITORIAL', name: '商业杂志', group: 'EDITORIAL', description: '克制、成熟，适合财经、公司与行业分析', swatches: ['#F3F5F7', '#25324B', '#7EA0C4', '#C9A86A'],
    prompt: '现代商业杂志视觉；冷白、石墨蓝、钢蓝和少量低饱和金色；严谨网格，主体裁切大胆但不过分；图表与照片保持同一编辑秩序；细腻铜版纸质感，明暗对比清楚；避免交易软件截图感、金钱符号堆叠、黑金土豪风和夸张成功学视觉',
  },
  {
    id: 'SWISS_GRID', name: '瑞士网格', group: 'EDITORIAL', description: '强网格与高对比，适合观点、清单与专题封面', swatches: ['#F5F4F0', '#171717', '#E74B3C', '#2F67C7'],
    prompt: '瑞士国际主义平面设计；暖白底、纯黑文字结构、信号红与钴蓝点缀；严格模数网格，不对称排版，几何块面和明确对齐；无衬线字体气质，字号层级强；哑光印刷质感；避免圆润卡通、渐变光效、装饰性花纹和随意居中',
  },
  {
    id: 'DOCUMENTARY', name: '纪实报道', group: 'EDITORIAL', description: '真实自然，适合新闻、人物与现场资料', swatches: ['#E7E4DE', '#6F786F', '#A98D70', '#28312F'],
    prompt: '克制的纪实报道摄影；自然光、真实材质与真实环境色，低饱和灰绿和中性肤色；观察式构图，保留环境关系与现场细节；轻微胶片颗粒，锐度自然；不摆拍、不磨皮、不制造戏剧冲突，不伪造新闻现场、机构标识或人物行为',
  },
  {
    id: 'CINEMATIC_DOCUMENTARY', name: '电影纪实', group: 'EDITORIAL', description: '叙事光影更强，适合故事、人物与社会议题', swatches: ['#17212B', '#54707D', '#D49B72', '#D9D5CC'],
    prompt: '电影感纪实摄影；蓝灰阴影、自然暖肤色和低饱和环境色；使用真实可解释的侧光或窗光，宽银幕式层次和前中后景；克制胶片颗粒与柔和高光；画面有叙事张力但保持事实边界；避免赛博霓虹、过暗看不清、虚构现场和夸张灾难感',
  },
  {
    id: 'MINIMAL_KNOWLEDGE', name: '极简知识图', group: 'KNOWLEDGE', description: '少色高密度，适合方法、结构与知识解释', swatches: ['#FAFAF7', '#DCE8F5', '#F3D58A', '#27364A'],
    prompt: '极简中文知识图解；近白底、雾蓝、浅黄和深灰蓝；信息先于装饰，使用细线、简洁图标、编号与清晰分区；网格稳定，模块间留白充分，手机缩略图仍可读；扁平印刷质感；避免渐变背景、伪3D图表、密集小字、无意义图标和模板化卡片堆叠',
  },
  {
    id: 'DATA_VISUAL', name: '数据可视化', group: 'KNOWLEDGE', description: '数据关系优先，适合趋势、对比与财经信息', swatches: ['#F7F9FB', '#2D6CDF', '#22A67A', '#F0B44D'],
    prompt: '专业编辑数据可视化；冷白底、蓝绿主数据色与琥珀强调色；图表类型必须匹配数据关系，坐标、单位、图例和来源区清晰；关键数字优先，辅助线克制，颜色具有一致语义；避免仪表盘截图、3D饼图、彩虹配色、虚构精确数据和无依据趋势线',
  },
  {
    id: 'BLUEPRINT_DIAGRAM', name: '蓝图图解', group: 'KNOWLEDGE', description: '工程结构感，适合技术原理、流程与系统关系', swatches: ['#EAF2F7', '#315A78', '#7CA5BC', '#F2B66D'],
    prompt: '现代工程蓝图图解；浅灰蓝纸底、深蓝线稿、雾青辅助线和少量橙色关键标记；轴测或正投影视角，结构关系、连线和编号精确；细密但可读的技术绘图质感；避免纯深蓝底老式蓝图、科幻HUD、无意义电路线和无法解释的机械细节',
  },
  {
    id: 'HAND_DRAWN_NOTES', name: '手绘笔记', group: 'KNOWLEDGE', description: '亲和、有温度，适合教程、读书与个人经验', swatches: ['#FFFDF5', '#466B5B', '#E5A65B', '#D97873'],
    prompt: '整洁的手绘知识笔记；柔白纸张、墨绿线条、橙黄和珊瑚红重点；真实手写线条气质但文字必须清晰，使用箭头、圈注、小图标与分区框建立阅读路径；轻微纸纤维质感；避免儿童涂鸦、过多贴纸、荧光笔铺满和无法识别的手写字',
  },
  {
    id: 'RETRO_POP', name: '清新波普怀旧', group: 'ILLUSTRATION', description: '马卡龙撞色与复古印刷，轻快但不俗气', swatches: ['#BFE3E0', '#F7B7C5', '#F6D76B', '#315D8A'],
    prompt: '清新波普怀旧编辑插画；薄荷绿、婴儿蓝、珊瑚粉、奶油黄与少量深蓝描边，禁止棕黄旧照片主色；采用复古丝网印刷网点、剪纸几何块、粗细有节奏的黑色轮廓和轻微错版质感；构图活泼但信息区整齐，主体简洁有记忆点；避免霓虹渐变、厚重做旧、廉价卡通和元素堆满',
  },
  {
    id: 'PAPER_COLLAGE', name: '纸感拼贴', group: 'ILLUSTRATION', description: '照片与纸片混合，适合人文、历史与观点表达', swatches: ['#F1EEE8', '#91A8A4', '#D88373', '#3B4252'],
    prompt: '现代纸感编辑拼贴；灰白纸、鼠尾草绿、陶土红和深灰蓝；使用真实照片裁片、色纸、撕边和少量铅笔线组合，保持清楚的视觉中心与层次；纸张阴影浅而真实；避免素材随意堆叠、复古棕色滤镜、邮票贴纸泛滥和版权标识',
  },
  {
    id: 'FLAT_GEOMETRIC', name: '扁平几何', group: 'ILLUSTRATION', description: '简洁现代，适合概念、商业与产品场景', swatches: ['#F6F7F2', '#5A8DEE', '#64C2A6', '#F2A65A'],
    prompt: '现代扁平几何插画；明亮中性底、钴蓝、青绿和暖橙；用清楚的几何形、简化人物与对象表达关系，透视统一，轮廓干净；构图留白充分，重点对象比例明确；避免企业素材库套图感、紫蓝AI渐变、过度圆润和无意义漂浮元素',
  },
  {
    id: 'SOFT_3D', name: '柔和 3D', group: 'ILLUSTRATION', description: '有体积但不过分卡通，适合产品与概念主视觉', swatches: ['#F2F5F7', '#9CC8E8', '#B9D6B0', '#F0B6A8'],
    prompt: '柔和编辑型3D视觉；冷白背景、雾蓝、嫩绿和浅珊瑚；使用哑光材质、柔和环境光、清晰接触阴影和简洁实体模型；主体集中，空间关系可解释，边缘精致；避免塑料玩具感、糖果色过饱和、漂浮球体装饰、金属炫光和复杂科幻场景',
  },
  {
    id: 'NEW_CHINESE', name: '新中式', group: 'CULTURAL', description: '东方秩序与现代编辑感，适合文化、国学与品牌', swatches: ['#F4F1EA', '#4D665A', '#B84A3A', '#28312E'],
    prompt: '现代新中式编辑视觉；宣纸白、松石灰绿、朱砂红和墨黑；使用东方留白、竖向节奏、窗棂或器物轮廓等克制元素，与现代网格结合；材质为细腻纸张、木、陶或织物；避免宫廷金色堆砌、龙凤祥云滥用、影楼古风和仿古棕黄滤镜',
  },
  {
    id: 'INK_WASH', name: '水墨留白', group: 'CULTURAL', description: '轻墨与大留白，适合诗词、哲思与人文内容', swatches: ['#F7F6F1', '#262B2C', '#899A91', '#B75A4A'],
    prompt: '当代水墨留白视觉；纸白、墨黑、灰绿与一点朱红；墨色有干湿浓淡，主体笔触简练，大片留白承担节奏；可融入极少现代几何或编辑标注；避免满幅山水模板、书法乱码、古装人物脸谱化和廉价卷轴边框',
  },
  {
    id: 'GUOCHAO_POSTER', name: '现代国潮', group: 'CULTURAL', description: '高对比东方图形，适合节日、历史与强传播封面', swatches: ['#F0E8D8', '#D33C32', '#216A70', '#202329'],
    prompt: '现代国潮海报视觉；纸白、正红、孔雀青与炭黑；传统纹样只做结构性点缀，结合大胆裁切、层叠图形和现代中文海报网格；印刷套色清楚，画面有力量且不过度繁复；避免大面积金色、龙凤祥云堆叠、旅游纪念品感和文字花哨变形',
  },
  {
    id: 'TECH_MEDIA', name: '科技媒体', group: 'TECHNOLOGY', description: '精准、冷静，适合 AI、互联网与产业科技', swatches: ['#F3F6F8', '#2864DC', '#29A38A', '#1E293B'],
    prompt: '现代科技媒体编辑视觉；浅冷灰底、钴蓝、青绿和深石墨色；使用精确网格、真实产品或技术结构、克制的数据元素与细线连接；画面明亮清晰，重点关系可解释；避免紫蓝霓虹渐变、发光大脑、机器人剪影、代码雨、HUD界面和无依据未来城市',
  },
  {
    id: 'MONO_EDITORIAL', name: '黑白刊物', group: 'EDITORIAL', description: '高反差黑白，适合人物观点与深度专题', swatches: ['#F7F7F4', '#171717', '#737373', '#D8D8D2'],
    prompt: '现代黑白独立刊物视觉；以纸白、炭黑和两级灰度建立层次，只保留一个极小的灰色强调；使用大胆裁切、非对称栏目网格、醒目的留白和克制编号；照片保持真实颗粒与清楚中间调；避免黑底白字铺满、奢侈品广告感、装饰线滥用和过暗细节丢失',
  },
  {
    id: 'NEWSPAPER_EDITORIAL', name: '现代报刊', group: 'EDITORIAL', description: '栏目与标题感强，适合时事、评论与历史', swatches: ['#F5F2EA', '#202020', '#A52D2D', '#7F8A82'],
    prompt: '现代中文报刊专题视觉；柔和新闻纸底、墨黑正文结构、暗红重点和灰绿辅助；多栏网格、醒目标题、细分隔线与资料图片形成清楚阅读秩序；保留轻微油墨渗透和纸纤维；避免仿旧发黄过度、英文假报头、密集小字和复古贴纸拼盘',
  },
  {
    id: 'LIFESTYLE_PHOTO', name: '生活方式摄影', group: 'EDITORIAL', description: '自然松弛，适合成长、职场与生活经验', swatches: ['#F7F4EE', '#9DB8AD', '#D7A48F', '#4B5960'],
    prompt: '当代生活方式编辑摄影；柔和自然日光、低饱和鼠尾草绿、浅珊瑚和中性灰蓝；记录真实空间、手部动作与日常物件，构图松弛但主体明确，保留可用于标题的自然留白；材质真实不过度磨皮；避免摆拍微笑、网红奶油滤镜、空洞咖啡桌和无关装饰物',
  },
  {
    id: 'CONSULTING_REPORT', name: '咨询报告', group: 'KNOWLEDGE', description: '结论先行，适合策略、行业与商业框架', swatches: ['#F7F8FA', '#173B73', '#5B83B4', '#D9A441'],
    prompt: '专业咨询报告信息视觉；冷白底、深海军蓝、钢蓝和少量琥珀色强调；结论置顶，使用矩阵、阶段箭头、结构树和关键数字建立咨询式阅读路径；网格严谨、标签简短、信息密度高但不拥挤；避免PPT默认SmartArt、彩虹配色、虚构数据和大段正文塞进图片',
  },
  {
    id: 'SCIENCE_ATLAS', name: '科普图谱', group: 'KNOWLEDGE', description: '结构准确，适合自然、医学与技术科普', swatches: ['#F5F8F7', '#2D6B66', '#85B8A5', '#E3A55B'],
    prompt: '现代科普图谱视觉；清洁浅灰白底、深青绿、植物绿与少量橙色标注；以剖面、局部放大、编号引线和尺度关系解释结构，主体准确、标注对应明确；兼具自然绘图质感和现代编辑网格；避免伪科学器官结构、无意义分子式、儿童教材卡通化和无法辨认的小标签',
  },
  {
    id: 'PENCIL_SKETCH', name: '铅笔线稿', group: 'ILLUSTRATION', description: '轻巧克制，适合思考、教程与人物故事', swatches: ['#FAF8F2', '#353A40', '#9AA6A0', '#D68A78'],
    prompt: '精致编辑型铅笔线稿；暖白素描纸、石墨灰、灰绿和少量陶粉色；线条有轻重与停顿，使用局部排线表达体积，构图像设计手稿而非儿童涂鸦；主体清楚，旁注与箭头保持克制；避免脏乱擦痕、漫画夸张表情、满页手写字和机械描边感',
  },
  {
    id: 'WOODCUT_PRINT', name: '木刻版画', group: 'CULTURAL', description: '粗粝有力，适合历史、民俗与人物主题', swatches: ['#F2EBDD', '#1F2724', '#B63C31', '#315F61'],
    prompt: '当代木刻版画海报视觉；米白纸、深墨黑、砖红和孔雀青；用粗细刀痕、黑白块面对比和有限套色塑造人物或历史场景，构图集中而有力量；保留真实印刷压痕与轻微套色偏差；避免旅游纪念品图案、满版传统纹样、仿古棕黄和过度血腥戏剧化',
  },
  {
    id: 'INDUSTRIAL_MEDIA', name: '工业纪实', group: 'TECHNOLOGY', description: '真实硬朗，适合制造、汽车与产业现场', swatches: ['#EEF1F2', '#39464F', '#6F8F93', '#E18B47'],
    prompt: '现代工业纪实媒体视觉；冷灰、钢铁蓝、低饱和青灰和安全橙点缀；真实工厂、设备、材料与作业关系优先，使用清晰透视、自然工业光和适度广角交代尺度；细节锐利但不过分HDR；避免科幻工厂、无人物空车间、蓝色霓虹、虚构品牌标识和廉价宣传片光效',
  },
  {
    id: 'MACARON_CARTOON', name: '马卡龙卡通', group: 'ILLUSTRATION', description: '轻松亲和，适合生活方式、工具教程与小红书图文', swatches: ['#FFF9F2', '#A8DDE0', '#F5B8CA', '#F4D56A'],
    prompt: '清新马卡龙编辑卡通；珍珠白底，薄荷青、樱花粉、奶油黄与少量深蓝描边；人物和物件造型简洁、有自然动作与真实使用关系，轮廓圆润但不幼儿化；画面有明确前中后层次和标题安全区；避免廉价贴纸感、过度卖萌、表情包、糖果色过饱和、漂浮装饰和素材库套图感',
  },
  {
    id: 'PIXEL_RETRO', name: '像素复古', group: 'ILLUSTRATION', description: '像素叙事与现代排版，适合科技、游戏、历史回看与轻科普', swatches: ['#F5F0E8', '#345995', '#E86A5A', '#58A88A'],
    prompt: '现代编辑型像素艺术；使用有限但清新的复古调色板、清晰像素网格和有层次的场景叙事，主体轮廓在手机缩略图中仍然可辨；像素插画与现代留白网格结合，保留标题安全区；避免低清放大截图、霓虹紫蓝渐变、杂乱游戏UI、版权角色、8位素材拼盘和无法辨认的小字',
  },
  {
    id: 'CYBER_TECH', name: '清透赛博', group: 'TECHNOLOGY', description: '高对比数字空间，适合前沿科技、未来产业与数字文化', swatches: ['#0B1020', '#20D9D2', '#F24F8A', '#E8F4FF'],
    prompt: '清透克制的现代赛博编辑视觉；深墨黑与冷白建立强对比，以电光青和少量玫红作功能强调；使用真实可解释的数字界面层次、透明材质、精确透视和细密光线，主体清楚并保留标题安全区；避免通篇紫蓝渐变、代码雨、发光大脑、廉价HUD堆叠、未来城市套图和过暗细节丢失',
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
  WOODCUT_PRINT: { caseLabel: '民俗人物', caseTitle: '土地上生长出的故事', caseMeta: '刀痕块面 · 有限套色' },
  TECH_MEDIA: { caseLabel: '前沿科技', caseTitle: '智能体正在重写工作流', caseMeta: '结构数据 · 明亮冷静' },
  INDUSTRIAL_MEDIA: { caseLabel: '产业现场', caseTitle: '制造业里的新效率', caseMeta: '真实设备 · 工业尺度' },
  MACARON_CARTOON: { caseLabel: '轻松教程', caseTitle: '每天十分钟，整理自己的信息流', caseMeta: '亲和人物 · 清新套色' },
  PIXEL_RETRO: { caseLabel: '科技回看', caseTitle: '从工具箱到智能工作流', caseMeta: '像素叙事 · 现代网格' },
  CYBER_TECH: { caseLabel: '数字前沿', caseTitle: '智能体如何协同完成工作', caseMeta: '透明界面 · 电光强调' },
};

const featuredStylePreviews = {
  FRESH_EDITORIAL: '/visual-style-previews/fresh-editorial.png',
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
  DATA_VISUAL: '/visual-style-previews/data-visual.png',
  CINEMATIC_DOCUMENTARY: '/visual-style-previews/cinematic-documentary.png',
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

function sizeFor(platform, role) {
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
  const template = templateFor(item.visualType, item.templatePreset);
  const structure = structureInstruction(item);
  const reference = referenceInstruction(item.references);
  if (mode === 'INFOGRAPHIC') {
    const headline = item.role === 'COVER' || item.role === 'MAIN' ? title : clean(item.focus).replace(/、/g, '与');
    const labels = (item.contentBlocks ?? []).map((block) => clean(block.label)).filter(Boolean).slice(0, 4);
    const labelText = labels.join('、');
    return {
      generationMode: mode,
      prompt: `为${platformLabel}内容《${title}》制作一张${roleLabel}${visualTypeLabels[item.visualType]}。画面内容优先：${item.focus}。用图形、对象、空间关系、时间顺序或数据形态直接讲清楚“${item.purpose}”，不要做成文字型 PPT、课程卡片或大段文字海报。视觉风格：${style}。构图参考：${template.prompt}。${structure}图内文字必须极少：${item.role === 'COVER' || item.role === 'MAIN' || item.role === 'CARD' ? `只允许一个短标题“${headline}”` : '不要文章标题'}${labelText ? `，以及必要短标签“${labelText}”` : ''}；不生成正文段落、解释句、序号清单或装饰性文字。平台版式：${infographicStyle(platform)}。${reference}${avoid}不得出现错别字、乱码、文字变形、水印、Logo、二维码；不得自行添加数据、机构、人物引语或未经正文支持的结论。`,
    };
  }
  return {
    generationMode: mode,
    prompt: `为${platformLabel}内容《${title}》制作一张${roleLabel}${visualTypeLabels[item.visualType]}。画面主体：${item.focus}。先表现可见的主体、动作、环境和关键关系，让读者不看文字也能理解“${item.purpose}”。视觉风格：${style}。构图参考：${template.prompt}。${visualStyle(platform, item.role)}。${reference}${avoid}图片内容必须占主导，不做文字型 PPT、信息卡片或大段文字海报；只生成视觉素材，不在图片内生成文字、Logo、二维码或水印。画面真实、准确、干净，细节清晰；涉及新闻事件时采用概念视觉，不伪造新闻现场，不虚构具体机构标识。`,
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
  if (platform === 'WEIBO') return { min: 0, max: 1 };
  if (platform === 'XIAOHONGSHU') return { min: 5, max: 8 };
  if (platform === 'ZHIHU') return { min: 2, max: 4 };
  return { min: 2, max: 5 };
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
    size: sizeFor(platform, coverRole), assetReferenceId: null,
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
      size: sizeFor(platform, role), assetReferenceId: null,
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
      assetReferenceId: isCover || keepAssignedAssets ? previous?.assetReferenceId ?? null : null,
    };
  });
}

export function mergeVisualPlan(generated, persisted, legacyAssetIds = [], legacyCoverId = null, persistedVersion = 0) {
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
        assetReferenceId: previous.assetReferenceId ?? null,
      };
      return updateVisualPlanItem(merged, {}, { platform: item.id.split('-')[0].toUpperCase(), title: generated[0]?.sourceExcerpt || generated[0]?.focus || '未命名内容' });
    });
  }
  if (Array.isArray(persisted) && persistedVersion >= 2) {
    const persistedById = new Map(persisted.map((item) => [item.id, item]));
    return generated.map((item) => {
      const previous = persistedById.get(item.id);
      return previous ? { ...item, size: previous.size ?? item.size, assetReferenceId: previous.assetReferenceId ?? null } : item;
    });
  }
  const persistedCoverId = Array.isArray(persisted)
    ? persisted.find((item) => item.role === 'COVER' || item.role === 'MAIN')?.assetReferenceId
    : null;
  const coverId = persistedCoverId ?? legacyCoverId ?? legacyAssetIds[0] ?? null;
  return generated.map((item) => ({
    ...item,
    assetReferenceId: item.role === 'COVER' || item.role === 'MAIN' ? coverId : null,
  }));
}

export function resizeVisualPlan(generated, current = []) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return generated.map((item) => currentById.get(item.id) ?? item);
}
