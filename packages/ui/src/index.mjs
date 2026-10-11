import React,{createElement as h,useId} from 'react';
export const WORKSPACE_DOMAINS=Object.freeze(['code','music','poetry','persuasive-writing','research','legislation','image','video','voice','data','workflow']);
export const PRODUCT_MODES=Object.freeze(['academy','command']);
export function toolAnchor(domain,controlId){
  if(!WORKSPACE_DOMAINS.includes(domain))throw new TypeError('Unknown workspace domain');
  if(typeof controlId!=='string'||!/^[a-z][a-z0-9-]*$/.test(controlId))throw new TypeError('Invalid stable control ID');
  return domain+'.'+controlId;
}
export function validateControls(domain,controls){
  if(!Array.isArray(controls))throw new TypeError('Controls must be an array');
  const anchors=new Set();
  for(const c of controls){
    if(!c || typeof c.label!=='string' || !c.label.trim() || !['text','textarea','select','number'].includes(c.kind))throw new TypeError('Invalid control descriptor');
    const a=toolAnchor(domain,c.id);if(anchors.has(a))throw new TypeError('Duplicate control anchor '+a);anchors.add(a);
    if(c.kind==='select' && (!Array.isArray(c.options)||!c.options.every(v=>typeof v==='string')))throw new TypeError('Invalid select options');
  }
  return Object.freeze([...anchors]);
}
export const TOKENS=Object.freeze({
  academy:Object.freeze({radius:'12px',density:'comfortable',helpSlots:true}),
  command:Object.freeze({radius:'4px',density:'compact',helpSlots:false})
});
export function WorkspaceShell({product='command',domain,title,children,toolbar,headingLevel=2}){
  if(!PRODUCT_MODES.includes(product)||!WORKSPACE_DOMAINS.includes(domain))throw new TypeError('Unknown workspace/product');
  if(typeof title!=='string'||!title.trim())throw new TypeError('Workspace title required');
  const heading=headingLevel===1?'h1':headingLevel===3?'h3':'h2';
  return h('section',{className:'sie-workspace', 'data-product':product,'data-domain':domain,'data-density':TOKENS[product].density},h('header',{className:'sie-workspace-header'},h(heading,{className:'sie-heading'},title),toolbar?h('div',{className:'sie-workspace-tools'},toolbar):null),h('div',{className:'sie-workspace-body'},children));
}
export function ToolPanel({title,children,ariaLabel}){
  return h('section',{className:'sie-panel','aria-label':ariaLabel||title},title?h('h3',{className:'sie-panel-heading'},title):null,children);
}
export function ControlField({domain,control,value,onChange,disabled=false}){
  const unique=useId();
  const anchor=toolAnchor(domain,control.id);
  const htmlId='sie-'+unique.replace(/:/g,'-');
  const base={id:htmlId,name:anchor,'data-help-anchor':anchor,disabled:!!disabled,className:'sie-field-input',...((value===undefined)?{defaultValue:control.defaultValue||''}:{value,onChange:e=>onChange?.(e.currentTarget.value)})};
  const input=control.kind==='textarea'?h('textarea',{...base,rows:control.rows||4}):control.kind==='select'?h('select',base,control.options.map(opt=>h('option',{key:opt,value:opt},opt))):h('input',{...base,type:control.kind==='number'?'number':'text'});
  return h('div',{className:'sie-field','data-control':anchor},h('label',{className:'sie-field-label',htmlFor:htmlId},control.label),input,control.description?h('p',{className:'sie-field-description'},control.description):null);
}
export function DomainTool({product='command',domain,title,controls,values={},onFieldChange,onSubmit,submitLabel,children}){
  validateControls(domain,controls);
  const fields=controls.map(c=>h(ControlField,{key:c.id,domain,control:c,value:values[c.id],onChange:v=>onFieldChange?.(c.id,v)}));
  const action=onSubmit?h('button',{className:'sie-action',type:'submit'},submitLabel||'Continue'):null;
  return h(WorkspaceShell,{product,domain,title},h('form',{className:'sie-tool-form',onSubmit:e=>{e.preventDefault();onSubmit?.()}},...fields,children,action));
}
// The shared UI deliberately renders no teaching hints or tutor content.
// Academy overlays attach to stable data-help-anchor attributes externally.
