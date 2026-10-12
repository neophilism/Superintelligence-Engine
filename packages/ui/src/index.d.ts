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

export declare class ProjectPortalError extends Error {code:string;status:number}
export declare function parseProjectTransfer(url:string):{tenantId:string;projectId:string}|null;
export declare function buildProjectTransfer(base:string,tenantId:string,projectId:string):string;
export declare class ProjectPortalClient {
  constructor(args:{engineOrigin:string;product:ProductMode;fetchImpl?:typeof fetch});
  signInUrl():string;
  session():Promise<{authenticated:boolean;identityId?:string}>;
  tenants():Promise<{items:Array<{id:string;name:string;role:string}>}>;
  projects(tenantId:string):Promise<{items:Array<{id:string;title:string;kind:WorkspaceDomain;revision:number}>}>;
  createProject(tenantId:string,args:{title:string;kind:WorkspaceDomain}):Promise<{id:string;title:string;kind:WorkspaceDomain;revision:number}>;
  artifacts(tenantId:string,projectId:string):Promise<{items:Array<{id:string;mediaType:string;revision:number}>}>;
  revisions(tenantId:string,projectId:string,artifactId:string):Promise<{items:Array<{revision:number;mediaType:string;checksum:string}>}>;
  logout():Promise<null>;
}
export declare function ProjectPortal(props:{product?:ProductMode;engineOrigin?:string;companionOrigin?:string;domain?:WorkspaceDomain;onOpenProject?:(project:{id:string;title:string;kind:WorkspaceDomain;revision:number})=>void}):React.ReactElement;
