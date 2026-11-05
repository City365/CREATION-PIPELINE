# 实体引用、成品编译与逐项终审

一、实体引用
只收集当前组实际需要的角色、现场/画外说话人、场景及道具，不把整个实体库都放进成品。人物在场不代表必须清楚正面入镜，背景保留和主要表演分开。
用已给标准名与别名映射；匹配成功后以@标准名引用，不自行改资产名或制造@资产。对白里的称呼仍按原句，不因标准名映射而改词。
<Subject N>用于角色，<Scene N>用于场景，<Prop N>用于道具。本组内各类别从1连续编号，同一实体不重复建号。跨组身份按标准实体名追踪，不按孤立的Subject数字追踪；数字重排不能使人物交换身份。
无绑定资产的实体只用普通文本名，不捏造@；需要在definitions中说明时标明text-only，不假装已有参考。此为本版兼容实现，具体导入兼容性另验。

二、正常输出协议
只有正式生成成品时使用本封装：响应第一个字符是_::~OUTPUT_START::~_的第一个下划线，最后一个字符是_::~OUTPUT_END::~_的最后一个下划线。前后没有解释、问候、Markdown代码围栏或结尾附言。
顺序固定：实体头部→===→总时长→subject_definitions→summary→retention_analysis→detailed_description→overall_soundscape→non_diegetic_music→结束标记。
实体头部写人物、场景、道具；该类确无项写None。它是清单，不新增主体或剧本动作。总时长写DURATION: [总时长Ts]。

subject_definitions: 逐条绑定本组需要的Subject、Scene、Prop。
summary: 以[reference generation]起始，简述本组原事件、承接和观看重点，不续写，不写调试标记、规则分析或来源长文。
retention_analysis: 按实际成品填写。可见角色列对应[Shot N]；画外/OS只闻其声的条目单独说明，不把有声音写成可见入镜。fully_preserved仅用于确已按本组要求保留的内容，不当默认口号。不要为了让分析好看而新增角色特写。
detailed_description: 先写16:9、无字幕、无音乐、服装绑定与本组光照总述，然后逐条镜头。
overall_soundscape: 整组环境、对白、现场画外声、OS和动作声的连续关系；与逐条SOUND一致。
non_diegetic_music: 固定N/A (No background music, no score, and no non-diegetic music.)。

三、每条镜头的九字段
编号只写[Shot N]，开始时标为累计视频时刻。每条按下列顺序，不留空：
LOCATION: 本条实际地点、内外、叙事时间、可见区域与光照。
CAMERA POSITION & SHOOTING DIRECTION: 相机的具体位置、拍向、人物屏幕位置、前中后景和关系轴线。
SHOT TYPE / FRAMING / CAMERA MOVEMENT: 观看功能、景别、主要机身运动和必要焦点/景深调度。
TIME MARKER: 叙事连续或原文明确跳转；无跳转写None (continuous)。
Action & Performance: 人物当前位置、姿态、朝向、主动作及实际可见反应；包含Primary Event和VISIBLE REACTIONS信息。条内有快切就按顺序说明，不新编号。
END FRAME / END BEAT: 原文截止时实际结束构图、身体/道具状态及焦点落点，供下一条承接。
Dialogue: 原词或授权过载后的执行句、说话人、OS/现场/现场画外与当句表演；无词写None。
SOUND: 本条实际声音的来源、空间和与前后连续关系；无音乐。
DURATION: 原条时长，单位s；0秒不得伪装成新增占时画面。

四、detailed_description固定约束文字
16:9 horizontal widescreen framing.
Widescreen composition with clear left-right relationships and foreground/midground/background depth. Use motivated camera movement and physically consistent in-scene lighting. No vertical-video framing. No center-crop-safe composition.
No subtitles. No captions. No burned-in text. No on-screen text overlay of any kind. Clean plate.
No background music. No score. No non-diegetic music.
All characters maintain the wardrobe of their bound @ references; scene context, role, emotion and posture do not change costumes.
随后写本组具体光照，不把这段通用约束当作本场光线说明。


## Dialogue标记与同Shot多原声

每条原声独立一行，格式如下；本行前缀声明声道，其后是当前句表演。

现场：@标准名 <Subject 1> (onscreen diegetic; pace / tone / delivery), says:<d>[Chinese]中文台词</d>
OS：@标准名 <Subject 1> (OS; pace / tone / delivery; no lip synchronization), says:<d>[Chinese]中文内心独白</d>
画外现场：@标准名 <Subject 1> (offscreen diegetic; physical source / pace / tone / delivery), says:<d>[Chinese]中文台词</d>

没有资产绑定时用普通文本名代替@标准名。多个原声在同一个Dialogue字段下逐行写，不增加源Shot编号；没有原声写Dialogue: None。成品骨架见[模板](../assets/output-template.txt)；实际完整例见[案例索引](examples/index.md)。

## 多组任务

逐组读取当前组及实际前组末态，每组独立使用首尾封装，Shot编号在组内从1开始。阅读用汇总可用空行分隔独立成品；具体软件批量导入协议未经本包验证，不自行声称该汇总可直接导入。不要用一组的结尾状态推进未发生的下一组事件。
