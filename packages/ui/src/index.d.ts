import * as React from 'react';
export type WorkspaceDomain='code'|'music'|'poetry'|'persuasive-writing'|'research'|'legislation'|'image'|'video'|'voice'|'data'|'workflow';
export type ProductMode='academy'|'command';
export interface ToolControl{id:string;label:string;kind:'text'|'textarea'|'select'|'number';options?:string[];defaultValue?:string;rows?:number;description?:string}
export declare const WORKSPACE_DOMAINS:readonly WorkspaceDomain[];
export declare const PRODUCT_MODES:readonly ProductMode[];
export declare const TOKENS:Readonly<Record<ProductMode,{radius:string;density:string;helpSlots:boolean}>>;
export declare function toolAnchor(domain:WorkspaceDomain,id:string):string;
export declare function validateControls(domain:WorkspaceDomain,controls:ToolControl[]):readonly string[];
export declare function WorkspaceShell(props:{product?:ProductMode;domain:WorkspaceDomain;title:string;toolbar?:React.ReactNode;headingLevel?:1|2|3;children?:React.ReactNode}):React.ReactElement;
export declare function ToolPanel(props:{title?:string;ariaLabel?:string;children?:React.ReactNode}):React.ReactElement;
export declare function ControlField(props:{domain:WorkspaceDomain;control:ToolControl;value?:string;onChange?:(value:string)=>void;disabled?:boolean}):React.ReactElement;
export declare function DomainTool(props:{product?:ProductMode;domain:WorkspaceDomain;title:string;controls:ToolControl[];values?:Record<string,string>;onFieldChange?:(id:string,value:string)=>void;onSubmit?:()=>void;submitLabel?:string;children?:React.ReactNode}):React.ReactElement;
