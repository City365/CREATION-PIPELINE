import pytest
from app.harness.completion import validate

@pytest.mark.parametrize('steps,errors,outcome',[
    ([],{},'partial'),
    ([{'status':'pending'}],{},'partial'),
    ([{'status':'blocked'}],{},'blocked'),
    ([{'status':'completed','output':'ok','evidence':[]}],{},'partial'),
    ([{'status':'completed','output':'ok','evidence':[{'id':'user_input'}]}],{'read':'error'},'partial'),
    ([{'status':'completed','output':'ok','evidence':[{'id':'user_input'}]}],{},'succeeded'),
])
def test_completion_invariants(steps,errors,outcome):
    assert validate({'plan':{'steps':steps},'tool_errors':errors},'answer')['outcome']==outcome

def test_empty_output_and_missing_artifact():
    assert validate({},'')['outcome']=='failed'
    receipt={'plan':{'steps':[{'status':'completed','output':'ok','evidence':[{'id':'user_input'}]}]},'artifacts':[{'id':'missing'}]}
    assert validate(receipt,'answer',lambda x:False)['outcome']=='partial'
