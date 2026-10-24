"""Project-scoped workspace files, searchable text index, knowledge and plugin configuration."""
import hashlib, io, json, re, uuid, zipfile
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from app import store
from app.execution import tick
ROOT=Path(__file__).resolve().parents[1]/'data'/'workspace'
MAX_BYTES=10*1024*1024
EXTENSIONS={'.txt','.md','.csv','.json','.xlsx','.docx','.pdf','.png','.jpg','.jpeg','.webp','.html','.htm','.mp3','.wav','.m4a','.ogg','.mp4','.webm'}

def db_open():
 db=store.connect()
 db.execute('CREATE TABLE IF NOT EXISTS workspace_files (id TEXT PRIMARY KEY, project TEXT NOT NULL, session_id TEXT, collection_id TEXT, name TEXT, suffix TEXT, size INTEGER, digest TEXT, status TEXT, text TEXT, error TEXT, created INTEGER)')
 db.execute('CREATE INDEX IF NOT EXISTS ix_workspace_project ON workspace_files(project)')
 db.execute('CREATE TABLE IF NOT EXISTS knowledge (id TEXT PRIMARY KEY, project TEXT NOT NULL, payload TEXT NOT NULL)')
 db.execute('CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)')
 try:db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS file_index USING fts5(text, project UNINDEXED, file_id UNINDEXED, part UNINDEXED, tokenize='trigram')")
 except Exception:db.execute('CREATE TABLE IF NOT EXISTS file_index (text TEXT, project TEXT, file_id TEXT, part INTEGER)')
 return db

def row_file(row):
 keys=['id','project','session_id','collection_id','name','suffix','size','digest','status','text','error','created']
 return dict(zip(keys,row))
def file_meta(row):
 item=row_file(row);item.pop('text',None);return item

def file_record(project,file_id,session_id=None):
 with db_open() as db:row=db.execute('SELECT * FROM workspace_files WHERE project=? AND id=?',(project,file_id)).fetchone()
 if not row:raise HTTPException(404,'文件不存在')
 item=row_file(row)
 if session_id is not None and item['session_id'] is not None and item['session_id']!=session_id and not item['collection_id']:raise HTTPException(404,'文件不在当前对话或知识库中')
 return item

def file_path(item):return ROOT/item['id']/(item['id']+item['suffix'])
def bounded_text(text):
 if len(text)>2000000:raise ValueError('文本超过 200 万字符，原件已保存，请拆分后建立索引')
 return text

def parse_file(data,suffix):
 if suffix in {'.mp3','.wav','.m4a','.ogg'}:return '', 'pending_transcription'
 if suffix in {'.mp4','.webm'}:return '', 'pending_video_analysis'
 if suffix in {'.html','.htm'}:
  from html.parser import HTMLParser
  class Extractor(HTMLParser):
   def __init__(self):super().__init__();self.parts=[];self.hidden=0
   def handle_starttag(self,tag,attrs):
    if tag in ('script','style'):self.hidden+=1
   def handle_endtag(self,tag):
    if tag in ('script','style'):self.hidden=max(0,self.hidden-1)
   def handle_data(self,data):
    if not self.hidden:self.parts.append(data)
  parser=Extractor();parser.feed(data.decode('utf-8-sig',errors='replace'))
  return bounded_text('\n'.join(parser.parts)),'indexed'
 if suffix in {'.png','.jpg','.jpeg','.webp'}:return '', 'pending_recognition'
 if suffix in {'.txt','.md','.csv','.json'}:
  for encoding in ('utf-8-sig','gb18030'):
   try:return bounded_text(data.decode(encoding)),'indexed'
   except UnicodeDecodeError:pass
  raise ValueError('文本编码无法识别，请使用 UTF-8')
 if suffix in {'.xlsx','.docx'}:
  with zipfile.ZipFile(io.BytesIO(data)) as archive:
   if sum(i.file_size for i in archive.infolist())>60*1024*1024:raise ValueError('解压后文件过大')
   if suffix=='.docx':
    from xml.etree import ElementTree
    xml=ElementTree.fromstring(archive.read('word/document.xml'))
    return bounded_text('\n'.join(''.join(p.itertext()) for p in xml.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))),'indexed'
  from openpyxl import load_workbook
  workbook=load_workbook(io.BytesIO(data),read_only=True,data_only=True)
  lines=[];characters=0
  try:
   for sheet in workbook:
    lines.append('工作表：'+sheet.title)
    for i,row in enumerate(sheet.iter_rows(values_only=True)):
     if i>=20000:raise ValueError('工作表超过 20000 行，原件已保存，请拆分分析文档')
     line=' | '.join(str(x) if x is not None else '' for x in row)
     characters+=len(line)+1
     if characters>2000000:raise ValueError('工作簿文本超过 200 万字符，原件已保存，请拆分')
     lines.append(line)
   return bounded_text('\n'.join(lines)),'indexed'
  finally:workbook.close()
 if suffix=='.pdf':
  from pypdf import PdfReader
  reader=PdfReader(io.BytesIO(data))
  if reader.is_encrypted:raise ValueError('暂不支持加密 PDF')
  if len(reader.pages)>200:raise ValueError('PDF 超过 200 页，原件已保存，请拆分')
  text=bounded_text('\n'.join((page.extract_text() or '') for page in reader.pages))
  return text,'indexed' if text.strip() else 'needs_ocr'
 raise ValueError('不支持该文件类型')

def save_upload(project,name,data,session_id=None,collection_id=None):
 suffix=Path(name).suffix.lower()
 if suffix not in EXTENSIONS:raise HTTPException(400,'不支持该文件类型')
 if not data or len(data)>MAX_BYTES:raise HTTPException(400,'文件不能为空且不能超过 10 MB')
 if session_id and not store.get_session(project,session_id):raise HTTPException(404,'所属对话不存在')
 with db_open() as db:
  if collection_id and not db.execute('SELECT 1 FROM knowledge WHERE id=? AND project=?',(collection_id,project)).fetchone():raise HTTPException(404,'知识库不存在')
 file_id='file_'+uuid.uuid4().hex
 text='';error=''
 try:text,status=parse_file(data,suffix)
 except Exception as exc:status='parse_failed';error=str(exc)[:200] if isinstance(exc,ValueError) else '文档解析失败，请检查格式'
 if status=='indexed' and not text.strip():status='empty'
 item={'id':file_id,'project':project,'session_id':session_id,'collection_id':collection_id,'name':Path(name.replace('\\','/')).name[:200],'suffix':suffix}
 path=file_path(item);path.parent.mkdir(parents=True,exist_ok=False);path.write_bytes(data)
 with db_open() as db:
  db.execute('INSERT INTO workspace_files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',(file_id,project,session_id,collection_id,item['name'],suffix,len(data),hashlib.sha256(data).hexdigest(),status,text,error,tick()))
  # File names are searchable even when visual content has not been recognized.
  chunks=[text[i:i+3000] for i in range(0,len(text),2800)] or ['文件名：'+item['name']]
  for i,chunk in enumerate(chunks):db.execute('INSERT INTO file_index (text,project,file_id,part) VALUES (?,?,?,?)',(item['name']+'\n'+chunk,project,file_id,i))
 return {k:v for k,v in file_record(project,file_id).items() if k!='text'}

def search_documents(project,session_id,query,limit=6):
 terms=[x for x in re.findall(r'[\w\u4e00-\u9fff]+',query) if x][:8]
 if not terms:return []
 scope='f.project=? AND (f.session_id=? OR f.collection_id IS NOT NULL OR f.session_id IS NULL)'
 with db_open() as db:
  params=[project,session_id]
  condition=' OR '.join('i.text LIKE ?' for _ in terms)
  params += ['%'+t+'%' for t in terms]
  rows=[]
  full_terms=[t for t in terms if len(t)>=3]
  if full_terms:
   try:rows=db.execute('SELECT f.id,f.name,f.status,i.part,i.text FROM file_index i JOIN workspace_files f ON f.id=i.file_id WHERE '+scope+' AND i.text MATCH ? LIMIT ?', (project,session_id,' OR '.join(chr(34)+t+chr(34) for t in full_terms),min(limit,10))).fetchall()
   except Exception:pass
  if not rows:rows=db.execute('SELECT f.id,f.name,f.status,i.part,i.text FROM file_index i JOIN workspace_files f ON f.id=i.file_id WHERE '+scope+' AND ('+condition+') LIMIT ?',(*params,min(limit,10))).fetchall()
 return [{'file_id':r[0],'name':r[1],'status':r[2],'chunk':r[3],'snippet':r[4][:3000],'source_id':'workspace:'+r[0]+':chunk:'+str(r[3])} for r in rows]

def read_document(project,session_id,file_id,start=0,limit=6000):
 item=file_record(project,file_id,session_id)
 if item['status']!='indexed':return {'ok':False,'file_id':file_id,'status':item['status'],'message':'文件已保存，但没有可读文本；图片及扫描件需要后续识别能力。'}
 start=max(0,start);limit=max(100,min(limit,12000));text=item['text'][start:start+limit]
 return {'ok':True,'file_id':file_id,'name':item['name'],'content':text,'start':start,'next_start':start+len(text) if start+len(text)<len(item['text']) else None,'characters':len(item['text']),'digest':item['digest'],'source_id':'workspace:'+file_id+':'+str(start)}

def create_artifact(project,session_id,name,format,content):
 format=format.lower().strip('.')
 if format not in {'txt','md','html','csv','xlsx'}:raise ValueError('可生成 txt、md、html、csv、xlsx')
 if not content.strip() or len(content)>300000:raise ValueError('文件内容不能为空，最多 30 万字符')
 name=Path(name.replace('\\','/')).stem[:120]+'.'+format
 if format=='xlsx':
  from openpyxl import Workbook
  data=json.loads(content)
  sheets=data.get('sheets') if isinstance(data,dict) else None
  if not isinstance(sheets,list) or not 1<=len(sheets)<=10:raise ValueError('xlsx 内容需为 {"sheets":[{"name":"Sheet1","rows":[["列名"],["值"]]}]}')
  book=Workbook();book.remove(book.active)
  for number,sheet in enumerate(sheets):
   if not isinstance(sheet,dict):raise ValueError('工作表需为对象')
   rows=sheet.get('rows')
   if not isinstance(rows,list) or len(rows)>10000:raise ValueError('每张表最多 10000 行')
   title=re.sub(r'[\\/*?:\[\]]','_',str(sheet.get('name') or 'Sheet'+str(number+1)))[:31]
   ws=book.create_sheet(title)
   for row in rows:
    if not isinstance(row,list) or len(row)>100:raise ValueError('每行需为数组，最多 100 列')
    clean=[]
    for value in row:
     if not isinstance(value,(str,int,float,bool,type(None))):raise ValueError('单元格仅支持文本、数字、布尔或空值')
     clean.append("'"+value if isinstance(value,str) and value.startswith(('=','+','-','@')) else value)
    ws.append(clean)
   ws.freeze_panes='A2'
   if ws.max_row>1:ws.auto_filter.ref=ws.dimensions
   for column in ws.columns:ws.column_dimensions[column[0].column_letter].width=min(45,max(14,max(len(str(c.value or '')) for c in column[:100])+2))
  stream=io.BytesIO();book.save(stream);book.close();body=stream.getvalue()
 else:body=content.encode('utf-8')
 result=save_upload(project,name,body,session_id=session_id)
 return {**result,'origin':'generated'}

def preview_file(project,file_id,sheet=0):
 item=file_record(project,file_id)
 base={k:item[k] for k in ('id','name','suffix','size','status','digest')}
 suffix=item['suffix']
 if suffix in {'.xlsx','.csv'}:
  if item['status']!='indexed':return {**base,'kind':'unsupported','message':item['error'] or '没有可读表格内容'}
  if suffix=='.csv':
   import csv
   reader=csv.reader(io.StringIO(item['text']))
   rows=[];wide=False
   for i,row in enumerate(reader):
    if i>=101:break
    wide=wide or len(row)>50
    rows.append(row[:50])
   return {**base,'kind':'spreadsheet','sheets':['CSV'],'sheet':0,'rows':rows[:100],'truncated':len(rows)>100 or wide,'row_limit':100,'column_limit':50}
  from openpyxl import load_workbook
  workbook=load_workbook(file_path(item),read_only=True,data_only=True)
  try:
   if sheet<0 or sheet>=len(workbook.sheetnames):raise HTTPException(400,'工作表不存在')
   ws=workbook.worksheets[sheet]
   rows=[[str(value) if value is not None and not isinstance(value,(str,int,float,bool)) else value for value in row] for row in ws.iter_rows(min_row=1,max_row=min(ws.max_row or 100,100),max_col=min(ws.max_column or 50,50),values_only=True)]
   return {**base,'kind':'spreadsheet','sheets':workbook.sheetnames,'sheet':sheet,'rows':rows,'total_rows':ws.max_row,'total_columns':ws.max_column,'truncated':(ws.max_row or 0)>100 or (ws.max_column or 0)>50,'row_limit':100,'column_limit':50}
  finally:workbook.close()
 if suffix in {'.txt','.md','.json','.html','.htm'}:
  text=file_path(item).read_text(encoding='utf-8-sig',errors='replace') if suffix in {'.html','.htm'} else item['text']
  return {**base,'kind':'html' if suffix in {'.html','.htm'} else 'markdown' if suffix=='.md' else 'text','content':text[:200000],'truncated':len(text)>200000}
 kind='image' if suffix in {'.png','.jpg','.jpeg','.webp'} else 'pdf' if suffix=='.pdf' else 'audio' if suffix in {'.mp3','.wav','.m4a','.ogg'} else 'video' if suffix in {'.mp4','.webm'} else 'text' if suffix=='.docx' else 'unsupported'
 return {**base,'kind':kind,**({'content':item['text'][:200000],'truncated':len(item['text'])>200000} if kind=='text' else {}),'message':'浏览器不支持该格式时可下载原件'}

class KnowledgeInput(BaseModel):
 name:str=Field(min_length=1,max_length=100)
 description:str=Field(default='',max_length=1000)
class PluginInput(BaseModel):
 kind:str
 name:str=Field(min_length=1,max_length=100)
 description:str=Field(default='',max_length=1000)
 enabled:bool=True
 config:dict=Field(default_factory=dict)

def mask(value):
 if isinstance(value,dict):return {k:'••••••' if any(t in k.lower() for t in ('secret','token','password','api_key','authorization')) else mask(v) for k,v in value.items()}
 if isinstance(value,list):return [mask(v) for v in value]
 return value

def plugins(project,kind=None):
 with db_open() as db:rows=db.execute('SELECT payload FROM plugins WHERE project=?'+(' AND kind=?' if kind else ''),(project,kind) if kind else (project,)).fetchall()
 return [json.loads(r[0]) for r in rows]

def router_for(project_dep):
 router=APIRouter(prefix='/agent',tags=['workspace'])
 @router.get('/workspace/files')
 def files(session_id:str|None=None,collection_id:str|None=None,project=Depends(project_dep)):
  sql='SELECT id,project,session_id,collection_id,name,suffix,size,digest,status,NULL,error,created FROM workspace_files WHERE project=?';params=[project]
  if session_id:sql+=' AND session_id=?';params.append(session_id)
  if collection_id:sql+=' AND collection_id=?';params.append(collection_id)
  with db_open() as db:return [file_meta(row) for row in db.execute(sql+' ORDER BY created DESC',params).fetchall()]
 @router.post('/workspace/files')
 async def upload(file:UploadFile=File(...),session_id:str|None=Form(None),collection_id:str|None=Form(None),project=Depends(project_dep)):
  data=await file.read(MAX_BYTES+1)
  from starlette.concurrency import run_in_threadpool
  return await run_in_threadpool(save_upload,project,file.filename or 'file',data,session_id,collection_id)
 @router.get('/workspace/files/{file_id}/preview')
 def preview(file_id:str,sheet:int=0,project=Depends(project_dep)):
  return preview_file(project,file_id,sheet)
 @router.get('/workspace/files/{file_id}/content')
 def content(file_id:str,start:int=0,limit:int=6000,project=Depends(project_dep)):
  item=file_record(project,file_id)
  return read_document(project,item['session_id'],file_id,start,limit)
 @router.get('/workspace/files/{file_id}/download')
 def download(file_id:str,project=Depends(project_dep)):
  item=file_record(project,file_id)
  return FileResponse(file_path(item),filename=item['name'],media_type='application/octet-stream')
 @router.delete('/workspace/files/{file_id}')
 def remove_file(file_id:str,project=Depends(project_dep)):
  item=file_record(project,file_id)
  with db_open() as db:
   db.execute('DELETE FROM file_index WHERE file_id=? AND project=?',(file_id,project))
   db.execute('DELETE FROM workspace_files WHERE id=? AND project=?',(file_id,project))
  file_path(item).unlink(missing_ok=True)
  return {'ok':True}
 @router.get('/knowledge')
 def knowledge(project=Depends(project_dep)):
  with db_open() as db:
   result=[json.loads(r[0]) for r in db.execute('SELECT payload FROM knowledge WHERE project=?',(project,))]
   for row in result:row['file_count']=db.execute('SELECT COUNT(*) FROM workspace_files WHERE project=? AND collection_id=?',(project,row['id'])).fetchone()[0]
   return result
 @router.post('/knowledge')
 def create_knowledge(body:KnowledgeInput,project=Depends(project_dep)):
  item={'id':'kb_'+uuid.uuid4().hex,**body.model_dump(),'created':tick()}
  with db_open() as db:db.execute('INSERT INTO knowledge VALUES (?,?,?)',(item['id'],project,json.dumps(item,ensure_ascii=False)))
  return item
 @router.put('/knowledge/{id}')
 def edit_knowledge(id:str,body:KnowledgeInput,project=Depends(project_dep)):
  with db_open() as db:
   row=db.execute('SELECT payload FROM knowledge WHERE id=? AND project=?',(id,project)).fetchone()
   if not row:raise HTTPException(404,'知识库不存在')
   item={**json.loads(row[0]),**body.model_dump()};db.execute('UPDATE knowledge SET payload=? WHERE id=? AND project=?',(json.dumps(item,ensure_ascii=False),id,project))
  return item
 @router.delete('/knowledge/{id}')
 def delete_knowledge(id:str,project=Depends(project_dep)):
  with db_open() as db:
   if db.execute('SELECT COUNT(*) FROM workspace_files WHERE project=? AND collection_id=?',(project,id)).fetchone()[0]:raise HTTPException(409,'请先移除该知识库中的文档')
   db.execute('DELETE FROM knowledge WHERE id=? AND project=?',(id,project))
  return {'ok':True}
 @router.get('/plugins')
 def list_plugins(project=Depends(project_dep)):
  from app.harness.registry import describe_plugin
  return mask([describe_plugin(item) for item in plugins(project)])
 @router.post('/plugins')
 def create_plugin(body:PluginInput,project=Depends(project_dep)):
  if body.kind not in ('tool','skill','mcp'):raise HTTPException(400,'类型应为 tool、skill 或 mcp')
  if len(json.dumps(body.config))>400000:raise HTTPException(400,'配置过大（技能提示词最多约 40 万字符）')
  item={'id':'plugin_'+uuid.uuid4().hex,**body.model_dump(),'created':tick(),'runtime_status':'available' if body.kind=='skill' and str(body.config.get('instructions','')).strip() else 'configured'}
  with db_open() as db:db.execute('INSERT INTO plugins VALUES (?,?,?,?)',(item['id'],project,body.kind,json.dumps(item,ensure_ascii=False)))
  return mask(item)
 @router.put('/plugins/{id}')
 def edit_plugin(id:str,body:PluginInput,project=Depends(project_dep)):
  with db_open() as db:
   row=db.execute('SELECT payload FROM plugins WHERE project=? AND id=?',(project,id)).fetchone()
   if not row:raise HTTPException(404,'插件不存在')
   old=json.loads(row[0])
   if old['kind']!=body.kind:raise HTTPException(400,'不能修改插件类型')
   def preserve(current,previous):
    previous=previous if isinstance(previous,dict) else {}
    return {k:previous.get(k,'') if v=='••••••' else preserve(v,previous.get(k,{})) if isinstance(v,dict) else v for k,v in current.items()}
   item={**old,**body.model_dump(),'config':preserve(body.config,old['config']),'runtime_status':'available' if body.kind=='skill' and str(body.config.get('instructions','')).strip() else 'configured'}
   db.execute('UPDATE plugins SET payload=? WHERE project=? AND id=?',(json.dumps(item,ensure_ascii=False),project,id))
  return mask(item)
 @router.delete('/plugins/{id}')
 def delete_plugin(id:str,project=Depends(project_dep)):
  with db_open() as db:db.execute('DELETE FROM plugins WHERE project=? AND id=?',(project,id))
  return {'ok':True}
 return router
