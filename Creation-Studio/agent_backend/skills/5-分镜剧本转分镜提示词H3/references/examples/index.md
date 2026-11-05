# 按任务选案例

案例只解释转换方法，不是当前剧情来源。选一个相关案例即可，不要全部载入。

- 快速查规则边界：[11个短例](short-cases.md)：命令不等于已执行、快切不扩号、移焦可见性、OS、零秒、音色缺失。
- 普通两条对话：[输入](normal-input.txt)、[资料](normal-assets.json)、[输出](normal-output.txt)、[末态](normal-state.json)。6秒2条；有显式声音卡。
- 同Shot多原声及OS跨切：[输入](multi-voice-input.txt)、[资料](multi-voice-assets.json)、[输出](multi-voice-output.txt)。8秒1条；三原声不重复，无固定音色资料。
- 字段转换的服务器依据：[09映射](server09-mapping.md)。是限于案例的公开自述；末段OS仅1.5秒覆盖窗存在容量问题，不作为时间通过案例。
- 过载改写及跨组三段：[说明](emergency-notes.md)，下列3组均15秒3条：
  - 第1组：[原稿](emergency-1-original.txt)、[执行稿](emergency-1-execution.txt)、[输出](emergency-1-output.txt)；
  - 第2组：[原稿](emergency-2-original.txt)、[执行稿](emergency-2-execution.txt)、[输出](emergency-2-output.txt)；
  - 第3组：[原稿](emergency-3-original.txt)、[执行稿](emergency-3-execution.txt)、[输出](emergency-3-output.txt)。
  - 全部7条原声的[预算](emergency-timing.json)和3处[改写审计](emergency-edits.json)。

普通/多原声案例为本地教学；急诊是按用户输入及本轮规则编写的本地转换结果。均不是本次新付费API返回，也没有实际音视频测试。
