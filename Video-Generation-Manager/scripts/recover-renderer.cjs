'use strict';
// Offline recovery helper. Evaluates only arithmetic/string-decoder declarations in an empty VM.
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {createRequire}=require('node:module');
const babel=createRequire(path.join(process.argv[2]||'D:/notebook/AIGC/rea','package.json'));
const parser=babel('@babel/parser'),traverse=babel('@babel/traverse').default,generate=babel('@babel/generator').default,t=babel('@babel/types');
const root=path.join(__dirname,'..');const source=fs.readFileSync(path.join(root,'recovered/renderer/app.js'),'utf8');const ast=parser.parse(source);
const helpers=ast.program.body.filter(n=>t.isFunctionDeclaration(n)&&/^_0x/.test(n.id.name));const helperNames=new Set(helpers.map(n=>n.id.name));
const header=helpers.map(n=>generate(n).code).join('\n')+'\n'+generate(ast.program.body[0]).code;
if(/\b(require|process|document|window|fetch|eval)\b/.test(header))throw Error('Decoder contains non-pure operations');
const sandbox=vm.createContext({});vm.runInContext(header,sandbox,{timeout:3000});const UNKNOWN=Symbol('unknown');
function calc(p,env=new Map(),depth=0){
  if(!p?.node||depth>30)return UNKNOWN;const n=p.node;
  if(t.isStringLiteral(n)||t.isNumericLiteral(n)||t.isBooleanLiteral(n))return n.value;
  if(t.isNullLiteral(n))return null;
  if(t.isIdentifier(n)){
    const b=p.scope.getBinding(n.name);if(!b)return UNKNOWN;if(env.has(b.identifier))return env.get(b.identifier);
    if(b.constant&&b.path.isVariableDeclarator())return calc(b.path.get('init'),env,depth+1);return UNKNOWN;
  }
  if(t.isObjectExpression(n)){
    const value={};for(const prop of p.get('properties')){if(!prop.isObjectProperty()||prop.node.computed)return UNKNOWN;const key=prop.node.key.name??prop.node.key.value;const v=calc(prop.get('value'),env,depth+1);if(v===UNKNOWN)return UNKNOWN;value[key]=v;}return value;
  }
  if(t.isMemberExpression(n)){
    const obj=calc(p.get('object'),env,depth+1),key=n.computed?calc(p.get('property'),env,depth+1):n.property.name;
    return obj!==UNKNOWN&&key!==UNKNOWN&&obj&&Object.prototype.hasOwnProperty.call(obj,key)?obj[key]:UNKNOWN;
  }
  if(t.isUnaryExpression(n)){
    const a=calc(p.get('argument'),env,depth+1);if(a===UNKNOWN)return UNKNOWN;
    if(n.operator==='-')return -a;if(n.operator==='+')return +a;if(n.operator==='!')return !a;if(n.operator==='~')return ~a;return UNKNOWN;
  }
  if(t.isBinaryExpression(n)){
    const a=calc(p.get('left'),env,depth+1),b=calc(p.get('right'),env,depth+1);if(a===UNKNOWN||b===UNKNOWN)return UNKNOWN;
    switch(n.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '^':return a^b;case '&':return a&b;case '|':return a|b;case '>>':return a>>b;case '<<':return a<<b;case '===':return a===b;default:return UNKNOWN;}
  }
  if(t.isCallExpression(n)&&t.isIdentifier(n.callee)){
    const values=p.get('arguments').map(a=>calc(a,env,depth+1));if(values.includes(UNKNOWN))return UNKNOWN;
    const binding=p.scope.getBinding(n.callee.name);if(!binding)return UNKNOWN;
    if(helperNames.has(n.callee.name)&&binding.scope.path.isProgram()){
      try{return sandbox[n.callee.name](...values);}catch{return UNKNOWN;}
    }
    if(!binding.path.isFunctionDeclaration())return UNKNOWN;
    const fn=binding.path;if(!fn.node.params.every(t.isIdentifier))return UNKNOWN;
    if(!fn.node.body.body.every(x=>t.isVariableDeclaration(x)||t.isFunctionDeclaration(x)||t.isReturnStatement(x)))return UNKNOWN;
    const nested=new Map(env);for(let i=0;i<fn.node.params.length;i++){const param=fn.scope.getBinding(fn.node.params[i].name);if(param)nested.set(param.identifier,values[i]);}
    const ret=fn.get('body.body').find(p=>p.isReturnStatement());return ret?calc(ret.get('argument'),nested,depth+1):UNKNOWN;
  }
  return UNKNOWN;
}
let replaced=0,folded=0;
traverse(ast,{CallExpression:{exit(p){const top=p.findParent(x=>x.parentPath?.isProgram());if(top&&(top.node===ast.program.body[0]||helpers.includes(top.node)))return;
  const value=calc(p);if(typeof value==='string'){p.replaceWith(t.stringLiteral(value));replaced++;}
}}});
for(let pass=0;pass<3;pass++)traverse(ast,{BinaryExpression:{exit(p){const v=calc(p);if((typeof v==='string'||typeof v==='number')&&Number.isFinite(typeof v==='number'?v:0)){p.replaceWith(t.valueToNode(v));folded++;}}}});
fs.writeFileSync(path.join(root,'recovered/renderer/app.decoded.js'),generate(ast,{comments:true,compact:false}).code+'\n');
fs.writeFileSync(path.join(root,'evidence/renderer-recovery.json'),JSON.stringify({decodedCalls:replaced,foldedExpressions:folded,remainingObfuscation:true,originalSourceRecovered:false},null,2));console.log(JSON.stringify({decodedCalls:replaced,foldedExpressions:folded}));
