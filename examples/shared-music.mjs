import React from 'react';
import {DomainTool} from '../packages/ui/src/index.mjs';
export const exampleMusicControls=[{id:'style',kind:'textarea',label:'Music style and instrumentation'},{id:'output',kind:'select',label:'Output type',options:['song','instrumental']}];
export const academyExample=React.createElement(DomainTool,{product:'academy',domain:'music',title:'Music Studio',controls:exampleMusicControls});
export const commandExample=React.createElement(DomainTool,{product:'command',domain:'music',title:'Music Studio',controls:exampleMusicControls});
