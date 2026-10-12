import {compileGoalChecklist,listGoalTemplates} from '../packages/workflows/src/index.mjs';
const [goal,...deliverables]=process.argv.slice(2);
if(!goal||deliverables.length===0){
 console.error('Usage: node scripts/preview-workflow.mjs <goal> <deliverable> [deliverable ...]');
 console.error('Available:',JSON.stringify(listGoalTemplates()));
 process.exitCode=2;
}else{
 try{console.log(JSON.stringify(compileGoalChecklist({goal,selected:deliverables}).preview,null,2))}
 catch(error){console.error(error.message);process.exitCode=1}
}