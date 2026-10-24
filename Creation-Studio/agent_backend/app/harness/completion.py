"""Structural completion, never a claim that model conclusions are business truth."""
def validate(receipt,answer,artifact_check=None):
    issues=[];steps=(receipt.get('plan') or {}).get('steps',[])
    if not answer.strip():return {'outcome':'failed','reason_code':'empty_response','validation_issues':['没有有效回复']}
    if not steps and receipt.get('plan_required', True):issues.append('缺少任务计划')
    if any(s.get('status')=='blocked' for s in steps):return {'outcome':'blocked','reason_code':'steps_blocked','validation_issues':['存在待补充的步骤']}
    if any(s.get('status')!='completed' for s in steps):issues.append('仍有步骤未完成')
    if any(s.get('status')=='completed' and (not s.get('output','').strip() or not s.get('evidence')) for s in steps):issues.append('已完成步骤缺少产出或依据')
    if receipt.get('tool_errors'):issues.append('存在尚未解决的工具错误')
    if receipt.get('side_effects'):issues.append('写入结果尚待对账')
    if artifact_check:
        for artifact in receipt.get('artifacts',[]):
            if not artifact_check(artifact):issues.append('交付文件缺失或内容指纹不匹配')
    return {'outcome':'partial' if issues else 'succeeded','reason_code':'completion_incomplete' if issues else 'validated_complete','validation_issues':issues}
