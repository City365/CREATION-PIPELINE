"""测试用的最小 MCP stdio 服务器：换行分隔的 JSON-RPC 2.0。

只实现握手、tools/list、tools/call 三个方法，够验证客户端全链路。
"""
import json
import sys


TOOLS = [
    {
        'name': 'echo',
        'description': '原样回显传入的文本',
        'inputSchema': {'type': 'object',
                        'properties': {'text': {'type': 'string', 'description': '要回显的文本'},
                                       'times': {'type': 'integer', 'description': '重复次数'}},
                        'required': ['text']},
    },
    {
        'name': 'fail',
        'description': '总是返回失败，用于验证错误传播',
        'inputSchema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'big',
        'description': '返回超长文本，用于验证落盘',
        'inputSchema': {'type': 'object',
                        'properties': {'chars': {'type': 'integer', 'description': '字符数'}}},
    },
]


def reply(rid, result):
    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': rid, 'result': result}, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        method = message.get('method')
        rid = message.get('id')
        params = message.get('params') or {}
        if method == 'initialize':
            reply(rid, {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}},
                        'serverInfo': {'name': 'echo', 'version': '1.0'}})
        elif method == 'notifications/initialized':
            continue
        elif method == 'tools/list':
            reply(rid, {'tools': TOOLS})
        elif method == 'tools/call':
            name = params.get('name')
            args = params.get('arguments') or {}
            if name == 'echo':
                times = int(args.get('times') or 1)
                text = str(args.get('text') or '')
                reply(rid, {'content': [{'type': 'text', 'text': text * times}], 'isError': False})
            elif name == 'big':
                reply(rid, {'content': [{'type': 'text', 'text': '宽' * int(args.get('chars') or 100)}],
                            'isError': False})
            elif name == 'fail':
                reply(rid, {'content': [{'type': 'text', 'text': '我失败了'}], 'isError': True})
            else:
                sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': rid,
                                             'error': {'code': -32601, 'message': '未知工具 ' + str(name)}},
                                            ensure_ascii=False) + '\n')
                sys.stdout.flush()
        elif rid is not None:
            sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': rid,
                                         'error': {'code': -32601, 'message': '未知方法'}},
                                        ensure_ascii=False) + '\n')
            sys.stdout.flush()


if __name__ == '__main__':
    main()
