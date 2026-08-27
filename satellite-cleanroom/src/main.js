import * as THREE from 'three';
import { createHeroMaterials, makeSoftDiscTexture } from './materials.js';
import { CleanroomWorld } from './cleanroom-world.js';
import { SatelliteModel } from './satellite-model.js';
import { MissionSelector, OrbitWorld } from './mission-visuals.js';
import { SatelliteAudio } from './audio.js';
import { SnapIntegration } from './snap-integration.js';
import { Technicians } from './technicians.js';
import { MISSION_DEFINITIONS, createMissionPlan, getMissionPlanStats, validateMissionPlan } from './mission-plan.js';
import { CLEANROOM_LAYOUT, CLEANROOM_LAYOUT_STATS, CLEANROOM_LAYOUT_ISSUES, validateCleanroomLayout } from './cleanroom-layout.js';
import { DeployableAssemblySystem } from './deployable-assembly-system.js';
import { PlannedSatelliteInstallation } from './planned-satellite-installation.js';

const app=document.getElementById('app');
const loader=document.getElementById('loader');
const audioToggle=document.getElementById('audio-toggle');
const replayButton=document.getElementById('replay');
const phaseBeads=document.getElementById('phase-beads');
const pauseShade=document.getElementById('pause-shade');

const PHASES=['chooseMission','airlock','airShower','crane','payload','harness','blanket','arrays','test','orbit','mission','complete'];
PHASES.forEach(()=>phaseBeads.appendChild(document.createElement('i')));

const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label','人工衛星を組み立てる3Dゲーム');
renderer.domElement.tabIndex=0;
app.appendChild(renderer.domElement);

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(48,1,.05,120);
const materials=createHeroMaterials();
const glowTexture=makeSoftDiscTexture();
const world=new CleanroomWorld(scene,materials,glowTexture);
const selector=new MissionSelector(materials,glowTexture);world.root.add(selector.root);
const orbitWorld=new OrbitWorld(scene,materials,glowTexture);
const technicians=new Technicians(world.root);
const satellite=new SatelliteModel(materials,glowTexture);scene.add(satellite.root);satellite.root.visible=false;
const deployables=new DeployableAssemblySystem(satellite.root,{materials,busHalfWidth:1.18,antennaPosition:[0,1.42,0]});
const installation=new PlannedSatelliteInstallation(satellite.root,{materials});
const audio=new SatelliteAudio();
const snap=new SnapIntegration({camera,viewport:()=>({width:renderer.domElement.clientWidth||innerWidth,height:renderer.domElement.clientHeight||innerHeight}),idleAfter:3.4});

const fade=document.createElement('div');
fade.style.cssText='position:fixed;inset:0;z-index:15;background:#06131f;opacity:0;pointer-events:none;transition:opacity .32s ease';
document.body.appendChild(fade);
const guide=document.createElement('div');
guide.setAttribute('aria-hidden','true');
guide.innerHTML='<span></span><b>☝</b>';
guide.style.cssText='position:fixed;z-index:19;left:0;top:0;width:86px;height:86px;margin:-43px 0 0 -43px;pointer-events:none;opacity:0;transition:opacity .25s;filter:drop-shadow(0 5px 8px rgba(20,55,70,.2))';
guide.firstElementChild.style.cssText='position:absolute;inset:10px;border:5px solid rgba(105,220,255,.9);border-radius:50%;box-shadow:0 0 0 7px rgba(255,255,255,.55),0 0 28px rgba(47,191,235,.8);animation:sat-pulse 1.15s ease-in-out infinite';
guide.lastElementChild.style.cssText='position:absolute;left:39px;top:38px;font:48px/1 system-ui;opacity:.74;transform:rotate(-18deg)';
document.body.appendChild(guide);
const style=document.createElement('style');style.textContent='@keyframes sat-pulse{0%,100%{transform:scale(.78);opacity:.55}50%{transform:scale(1.06);opacity:1}}';document.head.appendChild(style);

const missionDebug={
  weather:{mainInstrumentId:'cloud-imager',resultKind:'weather-clouds'},
  ocean:{mainInstrumentId:'ocean-scanner',resultKind:'ocean-currents'},
  communication:{mainInstrumentId:'communications-relay',resultKind:'communication-links'},
};

let phase='loading',missionId=null,missionProfile=null,missionPlan=null;
let cameraLook=new THREE.Vector3(),cameraTween=null;
let elapsed=0,lastFrame=performance.now(),lastInteraction=0,paused=false;
let renderScale=1,frameCostEma=1/60,nextQualityCheck=performance.now()+1600;
let activePointer=null,gesture=null,holdActive=false;
let transitionBusy=false,phaseEnteredAt=0,complete=false;
let payloadIndex=0,harnessIndex=0,blanketIndex=0,arrayInstallIndex=0;
let craneStage='horizontal',craneHorizontal=0,craneVertical=0;
let autoInstallProgress=0,missionSignalPending=false;
let freeCycles=0,freeRotations=0,earthTaps=0;
const phaseHistory=[];
const tweens=[];

const game={
  airlock:{cartInside:false,outerDoorClosed:false,innerDoorOpen:false},
  airShower:{progress:0,complete:false,cleanLamp:false},
  integration:{busIntegrated:false,locked:false,craneHorizontal:0,craneVertical:0},
  payload:{manualInstalled:0,total:3,mainInstrumentId:null,manualIds:[],autoInstalled:0,autoTotal:0},
  harness:{connected:0,total:3,progress:[0,0,0]},
  blanket:{installed:0,total:3,progress:[0,0,0]},
  arrays:{leftInstalled:false,rightInstalled:false,leftDeployment:0,rightDeployment:0,leftLocked:false,rightLocked:false},
  antenna:{installed:false,deployment:0,locked:false,kind:null},
  test:{progress:0,complete:false,lampsLit:0,totalLamps:3},
  orbit:{active:false,launchComplete:false},
  missionResult:{kind:null,visible:false,signals:0},
};

function clamp01(value){return Math.max(0,Math.min(1,value));}
function smooth(value){const k=clamp01(value);return k*k*(3-2*k);}
function portrait(){return innerHeight>innerWidth;}
function screenPoint(nx,ny){return{x:Math.round(innerWidth*nx),y:Math.round(innerHeight*ny)};}
function addTween(duration,fn,{delay=0,done=null,ease=smooth,tag=null}={}){const item={duration:Math.max(.001,duration),elapsed:-delay,fn,done,ease,tag};tweens.push(item);return item;}
function cancelTweens(tag){for(let i=tweens.length-1;i>=0;i--)if(tweens[i].tag===tag)tweens.splice(i,1);}
function updateTweens(dt){for(let i=tweens.length-1;i>=0;i--){const t=tweens[i];t.elapsed+=dt;if(t.elapsed<0)continue;const p=Math.min(1,t.elapsed/t.duration);t.fn(t.ease(p),p);if(p>=1){tweens.splice(i,1);t.done?.();}}}
function schedule(delay,done,tag=null){return addTween(.001,()=>{},{delay,done,ease:v=>v,tag});}

function shotData(id){
  if(id==='missionChoice')return portrait()?{position:[0,4.1,7.55],target:[0,1.65,.25],fov:68}:{position:[0,3.3,7.65],target:[0,1.65,.25],fov:51};
  const record=CLEANROOM_LAYOUT.cameras[id];const orientation=portrait()?'portrait':'landscape';
  if(!record)return{position:[0,3,9],target:[0,1,0],fov:48};
  return record[orientation];
}

function applyCamera(id,duration=.65){
  const shot=shotData(id);const fromPos=camera.position.clone(),fromLook=cameraLook.clone(),fromFov=camera.fov;
  const toPos=new THREE.Vector3(...shot.position),toLook=new THREE.Vector3(...shot.target);
  cancelTweens('camera');cameraTween=id;
  if(duration<=0){camera.position.copy(toPos);cameraLook.copy(toLook);camera.fov=shot.fov;camera.updateProjectionMatrix();cameraTween=null;return;}
  addTween(duration,k=>{camera.position.lerpVectors(fromPos,toPos,k);cameraLook.lerpVectors(fromLook,toLook,k);camera.fov=THREE.MathUtils.lerp(fromFov,shot.fov,k);camera.updateProjectionMatrix();},{tag:'camera',done:()=>{cameraTween=null;}});
}

function phaseShot(name){return({chooseMission:'missionChoice',airlock:'airlockWide',airShower:'airShowerSide',crane:'craneIntegration',payload:'payloadClose',harness:'harnessFront',blanket:'blanketMacro',arrays:'arraysSide',test:'testStand',orbit:'orbitWide',mission:'earthFinal',complete:'earthFinal'})[name];}

function enterPhase(next,{shot=phaseShot(next),cameraDuration=.62}={}){
  phase=next;phaseEnteredAt=elapsed;phaseHistory.push(next);lastInteraction=elapsed;guide.style.opacity='0';
  world.setPhase(next);technicians.setPhase(next);
  if(next==='chooseMission')technicians.setVisible(false);else if(!['orbit','mission','complete'].includes(next))technicians.setVisible(true);
  if(shot)applyCamera(shot,cameraDuration);
  const index=PHASES.indexOf(next);[...phaseBeads.children].forEach((bead,i)=>{bead.className=i<index?'done':i===index?'now':'';});
  phaseBeads.classList.toggle('hidden',next==='complete');
}

function projectWorld(position){
  const p=position.clone().project(camera);return{x:(p.x*.5+.5)*innerWidth,y:(-p.y*.5+.5)*innerHeight};
}

function projectedHoldTarget(id,object,holdMs){
  object.updateWorldMatrix(true,false);const p=projectWorld(object.getWorldPosition(new THREE.Vector3()));const margin=20;
  return{id,phase,action:'hold',x:Math.max(margin,Math.min(innerWidth-margin,p.x)),y:Math.max(margin,Math.min(innerHeight-margin,p.y)),radius:Math.round(Math.max(60,Math.min(innerWidth,innerHeight)*.115)),holdMs,enabled:true};
}

function resetState(){
  game.airlock={cartInside:false,outerDoorClosed:false,innerDoorOpen:false};game.airShower={progress:0,complete:false,cleanLamp:false};
  game.integration={busIntegrated:false,locked:false,craneHorizontal:0,craneVertical:0};
  game.payload={manualInstalled:0,total:3,mainInstrumentId:null,manualIds:[],autoInstalled:0,autoTotal:0};
  game.harness={connected:0,total:3,progress:[0,0,0]};game.blanket={installed:0,total:3,progress:[0,0,0]};
  game.arrays={leftInstalled:false,rightInstalled:false,leftDeployment:0,rightDeployment:0,leftLocked:false,rightLocked:false};
  game.antenna={installed:false,deployment:0,locked:false,kind:null};game.test={progress:0,complete:false,lampsLit:0,totalLamps:3};
  game.orbit={active:false,launchComplete:false};game.missionResult={kind:null,visible:false,signals:0};
  payloadIndex=0;harnessIndex=0;blanketIndex=0;arrayInstallIndex=0;craneStage='horizontal';craneHorizontal=0;craneVertical=0;autoInstallProgress=0;
  complete=false;missionSignalPending=false;freeCycles=0;freeRotations=0;earthTaps=0;
}

function startGame(){
  tweens.length=0;snap.cancel({restore:false});phaseHistory.length=0;transitionBusy=false;cameraTween=null;holdActive=false;activePointer=null;resetState();
  while(installProxies.length)disposeInstallProxy(installProxies[0]);
  world.keyLight.castShadow=true;renderer.shadowMap.needsUpdate=true;
  missionId=null;missionProfile=null;missionPlan=null;selector.reset();selector.root.visible=true;
  orbitWorld.setVisible(false);world.root.visible=true;scene.background.set(0xdce9ed);scene.fog=new THREE.Fog(0xdce9ed,22,54);
  technicians.setVisible(true);satellite.reset();satellite.root.removeFromParent();scene.add(satellite.root);satellite.root.visible=false;satellite.root.position.set(0,0,0);satellite.root.rotation.set(0,0,0);satellite.root.scale.setScalar(1);
  deployables.reset?.();installation.reset?.();
  world.cart.position.set(-4.8,.62,7.7);world.setOuterDoorClosed(false);world.setInnerDoorOpen(false);world.setTransferDoorOpen(false);world.setAirShower(0);world.setTestProgress(0);world.setCrane(-3.9,3.55);
  replayButton.classList.remove('show');replayButton.setAttribute('aria-hidden','true');
  audio.setMode('off');enterPhase('chooseMission',{cameraDuration:0});
}

function chooseMission(id){
  if(phase!=='chooseMission'||transitionBusy)return;
  missionId=id;selector.select(id);audio.unlock();audio.missionPreview(id);
  missionPlan=createMissionPlan({mission:id,seed:'cleanroom-family-satellite-v1'});
  const def=MISSION_DEFINITIONS[id],debug=missionDebug[id];
  missionProfile={...def,id,busAccent:missionPlan.busAccent,mainInstrumentId:debug.mainInstrumentId,resultKind:debug.resultKind,antennaKind:def.antenna.geometryKey};
  game.payload.mainInstrumentId=debug.mainInstrumentId;game.antenna.kind=def.antenna.geometryKey;game.missionResult.kind=debug.resultKind;
  satellite.setMission(missionProfile);deployables.setMission(id);installation.install(missionPlan,{mission:id});
  game.payload.autoTotal=missionPlan.entries.length;
  transitionBusy=true;
  schedule(.62,()=>{transitionBusy=false;enterAirlock();});
}

function enterAirlock(){
  selector.root.visible=false;satellite.root.visible=true;world.cart.position.set(0,.62,14.15);world.cartAnchor.add(satellite.root);satellite.root.position.set(0,.62,0);satellite.root.rotation.set(0,.12,0);
  enterPhase('airlock');audio.setMode('cleanroom');
  snap.begin({id:'cart-in',object:world.cart,start:world.cart.position.clone(),destination:new THREE.Vector3(0,.62,10.7),screenStart:screenPoint(.5,.76),screenDestination:screenPoint(.5,.43),fingerOffsetPx:42,onComplete:()=>{
    game.airlock.cartInside=true;game.airlock.outerDoorClosed=true;world.setOuterDoorClosed(true);audio.door(false,.65);transitionBusy=true;
    schedule(.75,()=>{transitionBusy=false;enterAirShower();});
  }});
}

function enterAirShower(){enterPhase('airShower');game.airShower.progress=0;audio.airShower(1.45);}

function finishAirShower(){
  if(game.airShower.complete)return;game.airShower.complete=true;game.airShower.cleanLamp=true;world.setAirShower(1);game.airlock.innerDoorOpen=true;world.setInnerDoorOpen(true);audio.success();audio.door(true,.65);transitionBusy=true;
  applyCamera('cleanroomWide',.55);
  const from=world.cart.position.clone();addTween(1.0,k=>{world.cart.position.lerpVectors(from,new THREE.Vector3(-3.9,.62,4.9),k);},{delay:.45,done:()=>{transitionBusy=false;enterCrane();}});
}

function enterCrane(){
  scene.attach(satellite.root);satellite.root.position.set(-3.9,3.55,-1);satellite.root.rotation.set(0,.12,0);world.setCrane(-3.9,3.55);
  enterPhase('crane');craneStage='horizontal';craneHorizontal=0;craneVertical=0;
}

function finishCraneHorizontal(){if(craneStage!=='horizontal')return;craneHorizontal=1;game.integration.craneHorizontal=1;craneStage='down';audio.crane(.55);lastInteraction=elapsed;}
function finishCraneDown(){
  if(craneStage!=='down')return;craneVertical=1;game.integration.craneVertical=1;craneStage='locked';world.standAnchor.attach(satellite.root);satellite.root.position.set(0,0,0);satellite.root.rotation.set(0,0,0);
  game.integration.busIntegrated=true;game.integration.locked=true;audio.dock();technicians.setPhase('payload');transitionBusy=true;schedule(.65,()=>{transitionBusy=false;enterPayload();});
}

function payloadStartPosition(index){return[new THREE.Vector3(-4.85,1.25,-2.1+index*1.15),new THREE.Vector3(-4.8,1.15,-.65),new THREE.Vector3(-4.75,1.35,.75)][index]??new THREE.Vector3(-4.8,1.2,0);}
function enterPayload(){enterPhase('payload');payloadIndex=0;showPayloadItem();}
function showPayloadItem(){
  const item=satellite.payloadModules[payloadIndex];if(!item){startAutoInstallation();return;}
  scene.add(item.group);item.group.visible=true;item.group.position.copy(payloadStartPosition(payloadIndex));item.group.rotation.set(0,0,0);item.group.scale.setScalar(.92);
  satellite.root.updateMatrixWorld(true);const destination=satellite.attachmentGroup.localToWorld(item.position.clone());
  snap.begin({id:`payload-${item.id}`,object:item.group,start:item.group.position.clone(),destination,screenStart:screenPoint(.18,.64-payloadIndex*.06),screenDestination:screenPoint(.54,.5),fingerOffsetPx:48,onComplete:()=>{
    satellite.installPayload(payloadIndex);game.payload.manualInstalled=satellite.payloadInstalled;game.payload.manualIds=satellite.payloadModules.filter(v=>v.installed).map(v=>v.id);audio.dock();payloadIndex++;transitionBusy=true;schedule(.45,()=>{transitionBusy=false;showPayloadItem();});
  }});
}

function startAutoInstallation(){
  transitionBusy=true;autoInstallProgress=0;installation.reveal(elapsed);
  addTween(1.35,k=>{autoInstallProgress=k;installation.setRevealProgress?.(k);game.payload.autoInstalled=Math.round(game.payload.autoTotal*k);},{done:()=>{game.payload.autoInstalled=game.payload.autoTotal;transitionBusy=false;enterHarness();}});
}

function harnessPath(index){
  const route=satellite.cableRoutes[index]??satellite.cableRoutes[0];const fingerOffset=Math.max(34,Math.min(56,innerHeight*.06)),margin=20;satellite.root.updateMatrixWorld(true);
  return route.map(point=>{const worldPoint=satellite.root.localToWorld(point.clone()),p=projectWorld(worldPoint);return{x:Math.max(margin,Math.min(innerWidth-margin,p.x)),y:Math.max(margin,Math.min(innerHeight-margin,p.y+fingerOffset))};});
}
function enterHarness(){enterPhase('harness');harnessIndex=0;game.harness.progress=[0,0,0];satellite.setHarnessGuidesVisible(true);}
function completeHarness(){
  const index=harnessIndex;if(index>=3)return;satellite.setCableProgress(index,1);game.harness.progress[index]=1;harnessIndex++;game.harness.connected=harnessIndex;audio.connector();
  transitionBusy=true;let pulse=0;addTween(.45,(k,p)=>{pulse=p;satellite.pulseCable(index,p);},{done:()=>{transitionBusy=false;if(harnessIndex>=3)enterBlanket();}});
}

function blanketSource(index){return[new THREE.Vector3(-3.1,-.2,1.35),new THREE.Vector3(-3.1,-.05,0),new THREE.Vector3(3.1,-.05,0)][index]??new THREE.Vector3(-3,0,0);}
function enterBlanket(){enterPhase('blanket');blanketIndex=0;showBlanketItem();}
function showBlanketItem(){
  const item=satellite.blankets[blanketIndex];if(!item){enterArrays();return;}
  satellite.showBlanket(blanketIndex);const final=item.group.position.clone();item.group.position.copy(blanketSource(blanketIndex));item.mesh.morphTargetInfluences[0]=1;
  snap.begin({id:`blanket-${blanketIndex+1}`,object:item.group,start:item.group.position.clone(),destination:final,screenStart:screenPoint(blanketIndex===2?.82:.18,.7-blanketIndex*.05),screenDestination:screenPoint(.52,.5),fingerOffsetPx:48,onComplete:()=>{
    audio.blanketRustle(.85);transitionBusy=true;let ratchetStep=0;
    addTween(1.1,(k,p)=>{satellite.setBlanketProgress(blanketIndex,k);game.blanket.progress[blanketIndex]=k;const step=Math.floor(k*6);if(step>ratchetStep){ratchetStep=step;audio.ratchet(1);}},{done:()=>{
      game.blanket.installed=blanketIndex+1;blanketIndex++;transitionBusy=false;showBlanketItem();
    }});
  }});
}

const installProxies=[];
function disposeInstallProxy(proxy){
  proxy.removeFromParent();proxy.traverse(object=>object.geometry?.dispose?.());
  const index=installProxies.indexOf(proxy);if(index>=0)installProxies.splice(index,1);
}
function makeArrayProxy(kind){
  const g=new THREE.Group();g.name=`folded-${kind}`;
  if(kind==='antenna'){
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.09,.12,.7,14),materials.rail);mast.position.y=.15;g.add(mast);
    const dish=new THREE.Mesh(new THREE.CylinderGeometry(.12,.52,.18,24,1,true),materials.aluminium);dish.position.y=.56;g.add(dish);
  }else{
    const frame=new THREE.Mesh(new THREE.BoxGeometry(.88,1.5,.14),materials.solarFrame);g.add(frame);
    for(let y=-.52;y<=.52;y+=.35)for(let x=-.27;x<=.27;x+=.27){const cell=new THREE.Mesh(new THREE.BoxGeometry(.22,.28,.025),materials.solarCell);cell.position.set(x,y,.085);g.add(cell);}
    const hinge=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,1.58,12),materials.rail);hinge.position.x=kind==='left'?.52:-.52;g.add(hinge);
  }
  scene.add(g);installProxies.push(g);return g;
}

function arrayPartDestination(kind){
  satellite.root.updateMatrixWorld(true);const local=kind==='left'?new THREE.Vector3(-1.28,0,0):kind==='right'?new THREE.Vector3(1.28,0,0):new THREE.Vector3(0,1.55,0);
  return satellite.root.localToWorld(local);
}

function enterArrays(){
  enterPhase('arrays');arrayInstallIndex=0;deployables.setInstalled('all',false);installNextArrayPart();
}

function installNextArrayPart(){
  const kinds=['left','right','antenna'];const kind=kinds[arrayInstallIndex];if(!kind){moveToTest();return;}
  const proxy=makeArrayProxy(kind);const start=kind==='left'?new THREE.Vector3(-4.2,1.4,1.2):kind==='right'?new THREE.Vector3(4.2,1.4,1.2):new THREE.Vector3(-4.1,1.7,1.3);
  proxy.position.copy(start);proxy.scale.setScalar(.82);
  snap.begin({id:`install-${kind}`,object:proxy,start,destination:arrayPartDestination(kind),screenStart:screenPoint(kind==='right'?.82:.18,kind==='antenna'?.61:.68),screenDestination:screenPoint(kind==='left'?.41:kind==='right'?.59:.5,kind==='antenna'?.36:.5),fingerOffsetPx:46,onComplete:()=>{
    disposeInstallProxy(proxy);deployables.setInstalled(kind,true);if(kind==='left')game.arrays.leftInstalled=true;else if(kind==='right')game.arrays.rightInstalled=true;else game.antenna.installed=true;
    audio.panelLock(kind);arrayInstallIndex++;transitionBusy=true;schedule(.42,()=>{transitionBusy=false;installNextArrayPart();});
  }});
}

function moveToTest(){
  transitionBusy=true;scene.attach(satellite.root);const from=satellite.root.position.clone();world.testAnchor.updateMatrixWorld(true);const to=world.testAnchor.getWorldPosition(new THREE.Vector3());
  const fromQ=satellite.root.quaternion.clone();const toQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-.32,0));
  addTween(1.05,k=>{satellite.root.position.lerpVectors(from,to,k);satellite.root.quaternion.slerpQuaternions(fromQ,toQ,k);},{done:()=>{world.testAnchor.attach(satellite.root);satellite.root.position.set(0,0,0);satellite.root.rotation.set(0,0,0);transitionBusy=false;enterTest();}});
}

function enterTest(){enterPhase('test');game.test.progress=0;world.setTestProgress(0);}
function finishTest(){
  if(game.test.complete)return;game.test.complete=true;game.test.progress=1;game.test.lampsLit=3;world.setTestProgress(1);audio.success();transitionBusy=true;world.setTransferDoorOpen(true);audio.door(true,.8);
  scene.attach(satellite.root);const from=satellite.root.position.clone(),to=from.clone().setZ(-10.25);
  addTween(1.15,k=>{satellite.root.position.lerpVectors(from,to,k);satellite.root.scale.setScalar(1-k*.18);},{delay:.35,done:()=>{audio.launch(1.7);fade.style.opacity='1';schedule(.42,()=>enterOrbit());}});
}

function enterOrbit(){
  world.root.visible=false;technicians.setVisible(false);orbitWorld.setOrientation(portrait());orbitWorld.setMission(missionProfile);orbitWorld.setVisible(true);
  // The cleanroom shadow map is useful during assembly, but in orbit it adds a
  // second render of the detailed satellite without a floor to receive it.
  // Space lighting is represented by the existing direct/hemisphere lights.
  world.keyLight.castShadow=false;
  scene.background.set(0x020813);scene.fog=null;orbitWorld.satelliteCarrier.attach(satellite.root);satellite.root.position.set(0,0,0);satellite.root.rotation.set(0,0,0);satellite.root.scale.setScalar(.92);
  deployables.setDeployment('both',0);deployables.setAntennaDeployment(0);game.orbit.active=true;game.orbit.launchComplete=true;
  audio.setMode('orbit');enterPhase('orbit',{cameraDuration:0});applyCamera('orbitWide',.7);fade.style.opacity='0';transitionBusy=false;
}

function setArrayDeployment(side,value){
  const p=clamp01(value);deployables.setDeployment(side,p);
  if(side==='left'){game.arrays.leftDeployment=p;game.arrays.leftLocked=p>=1;}else{game.arrays.rightDeployment=p;game.arrays.rightLocked=p>=1;}
}
function setAntennaDeployment(value){const p=clamp01(value);deployables.setAntennaDeployment(p);game.antenna.deployment=p;game.antenna.locked=p>=1;}

function maybeMission(){
  if(game.arrays.leftLocked&&game.arrays.rightLocked&&game.antenna.locked&&phase==='orbit'){
    transitionBusy=true;audio.success();schedule(.75,()=>{transitionBusy=false;enterMission();});
  }
}

function enterMission(){enterPhase('mission');missionSignalPending=false;}
function sendMissionSignal(){
  if(missionSignalPending)return;missionSignalPending=true;audio.signal(game.missionResult.signals);orbitWorld.sendSignal();game.missionResult.signals++;
  transitionBusy=true;schedule(.65,()=>{orbitWorld.showResult();game.missionResult.visible=true;audio.success();schedule(.75,()=>{transitionBusy=false;enterComplete();});});
}

function enterComplete(){
  complete=true;enterPhase('complete',{cameraDuration:.5});replayButton.classList.add('show');replayButton.setAttribute('aria-hidden','false');
}

function runFreeCycle(){
  if(transitionBusy)return;transitionBusy=true;freeCycles++;const from=game.arrays.leftDeployment;
  addTween(.65,k=>setArrayDeployment('left',THREE.MathUtils.lerp(from,0,k)),{done:()=>addTween(.95,k=>setArrayDeployment('left',k),{done:()=>{audio.panelLock('left');transitionBusy=false;}})});
}

function target(id,action,nx,ny,ex=nx,ey=ny,extra={}){
  const a=screenPoint(nx,ny),b=screenPoint(ex,ey),isDrag=['drag','swipe','trace'].includes(action);
  return{id,phase,action,x:a.x,y:a.y,...(isDrag?{endX:b.x,endY:b.y,dropX:b.x,dropY:b.y,drag:true}:{}),radius:Math.round(Math.max(54,Math.min(innerWidth,innerHeight)*.105)),enabled:true,...extra};
}

function snapTarget(){
  const raw=snap.target();if(!raw)return null;
  const margin=18;return{id:raw.id,phase,action:'drag',x:Math.max(margin,Math.min(innerWidth-margin,raw.x)),y:Math.max(margin,Math.min(innerHeight-margin,raw.y)),endX:Math.max(margin,Math.min(innerWidth-margin,raw.toX)),endY:Math.max(margin,Math.min(innerHeight-margin,raw.toY)),dropX:Math.max(margin,Math.min(innerWidth-margin,raw.toX)),dropY:Math.max(margin,Math.min(innerHeight-margin,raw.toY)),drag:true,radius:raw.radius,enabled:true};
}

function currentTargets(){
  if(transitionBusy||cameraTween||paused)return[];
  if(phase==='chooseMission')return[target('mission-weather','tap',.21,.52),target('mission-ocean','tap',.5,.52),target('mission-communication','tap',.79,.52)];
  if(['airlock','payload','blanket','arrays'].includes(phase)&&snap.active){const t=snapTarget();return t?[t]:[];}
  if(phase==='airShower')return[projectedHoldTarget('airflow-hold',world.airButton,1450)];
  if(phase==='crane')return craneStage==='horizontal'?[target('crane-horizontal','drag',.27,.43,.58,.43)]:craneStage==='down'?[target('crane-down','drag',.58,.4,.58,.7)]:[];
  if(phase==='harness'){
    if(harnessIndex>=3)return[];const path=harnessPath(harnessIndex);return[{id:`cable-${harnessIndex+1}`,phase,action:'trace',x:path[0].x,y:path[0].y,endX:path.at(-1).x,endY:path.at(-1).y,dropX:path.at(-1).x,dropY:path.at(-1).y,path,drag:true,radius:66,enabled:true}];
  }
  if(phase==='test')return[projectedHoldTarget('test-hold',world.testButton,1650)];
  if(phase==='orbit'){
    const list=[];if(!game.arrays.leftLocked)list.push(target('orbit-left-deploy','swipe',portrait()?.5:.42,portrait()?.43:.52,portrait()?.5:.13,portrait()?.17:.52));
    if(!game.arrays.rightLocked)list.push(target('orbit-right-deploy','swipe',portrait()?.5:.58,portrait()?.57:.52,portrait()?.5:.87,portrait()?.83:.52));
    if(!game.antenna.locked)list.push(target('orbit-antenna-deploy','swipe',.53,.38,.53,.18));return list;
  }
  if(phase==='mission')return[target('mission-send','tap',portrait()?.5:.68,portrait()?.33:.36)];
  if(phase==='complete')return[target('free-signal','tap',.66,.32),target('free-earth','tap',portrait()?.5:.26,portrait()?.73:.62),target('free-left-cycle','swipe',.42,.5,.18,.5),target('free-rotate','drag',.55,.58,.7,.58)];
  return[];
}

function chooseTargetAt(x,y){const targets=currentTargets();if(!targets.length)return null;return targets.reduce((best,t)=>Math.hypot(x-t.x,y-t.y)<Math.hypot(x-best.x,y-best.y)?t:best,targets[0]);}

function executeTap(id){
  if(id==='mission-send')sendMissionSignal();
  else if(id.startsWith('mission-'))chooseMission(id.replace('mission-',''));
  else if(id==='free-signal'){audio.signal(game.missionResult.signals);orbitWorld.sendSignal();game.missionResult.signals++;}
  else if(id==='free-earth'){earthTaps++;orbitWorld.globe.rotation.y+=.45;audio.tap();}
}

function startGesture(t,x,y){
  gesture={target:t,startX:x,startY:y,lastX:x,lastY:y,progress:0};lastInteraction=elapsed;
  if(t.action==='tap'){executeTap(t.id);return;}
  if(t.action==='hold'){holdActive=true;if(t.id==='test-hold')audio.test(1.5);return;}
  if(t.id==='orbit-left-deploy')applyCamera('hingeClose',.34);
  if(snap.active&&t.id===snap.target()?.id){snap.gestureStart({x,y});return;}
}

function updateCustomGesture(x,y){
  if(!gesture)return;gesture.lastX=x;gesture.lastY=y;const t=gesture.target;const dx=t.endX-t.x,dy=t.endY-t.y,len2=Math.max(1,dx*dx+dy*dy);const p=clamp01(((x-t.x)*dx+(y-t.y)*dy)/len2);gesture.progress=Math.max(gesture.progress,p);
  if(snap.active&&t.id===snap.target()?.id){snap.gestureMove({x,y});return;}
  if(t.id==='crane-horizontal'){craneHorizontal=gesture.progress;game.integration.craneHorizontal=craneHorizontal;const cx=THREE.MathUtils.lerp(-3.9,0,smooth(craneHorizontal));world.setCrane(cx,3.55);satellite.root.position.x=cx;}
  else if(t.id==='crane-down'){craneVertical=gesture.progress;game.integration.craneVertical=craneVertical;const cy=THREE.MathUtils.lerp(3.55,2.45,smooth(craneVertical));world.setCrane(0,cy);satellite.root.position.y=cy;}
  else if(t.id.startsWith('cable-')){satellite.setCableProgress(harnessIndex,gesture.progress);game.harness.progress[harnessIndex]=gesture.progress;}
  else if(t.id==='orbit-left-deploy')setArrayDeployment('left',gesture.progress);
  else if(t.id==='orbit-right-deploy')setArrayDeployment('right',gesture.progress);
  else if(t.id==='orbit-antenna-deploy')setAntennaDeployment(gesture.progress);
  else if(t.id==='free-rotate'){orbitWorld.satelliteCarrier.rotation.y+=(x-gesture.lastX)*.006;freeRotations++;}
}

function animateGestureToOne(id,from){
  transitionBusy=true;addTween(.52,k=>{
    const p=THREE.MathUtils.lerp(from,1,k);
    if(id==='crane-horizontal'){craneHorizontal=p;game.integration.craneHorizontal=p;const cx=THREE.MathUtils.lerp(-3.9,0,smooth(p));world.setCrane(cx,3.55);satellite.root.position.x=cx;}
    else if(id==='crane-down'){craneVertical=p;game.integration.craneVertical=p;const cy=THREE.MathUtils.lerp(3.55,2.45,smooth(p));world.setCrane(0,cy);satellite.root.position.y=cy;}
    else if(id.startsWith('cable-')){satellite.setCableProgress(harnessIndex,p);game.harness.progress[harnessIndex]=p;}
    else if(id==='orbit-left-deploy')setArrayDeployment('left',p);else if(id==='orbit-right-deploy')setArrayDeployment('right',p);else if(id==='orbit-antenna-deploy')setAntennaDeployment(p);
  },{done:()=>{
    transitionBusy=false;if(id==='crane-horizontal')finishCraneHorizontal();else if(id==='crane-down')finishCraneDown();else if(id.startsWith('cable-'))completeHarness();else if(id.startsWith('orbit-')){audio.panelLock(id.includes('left')?'left':id.includes('right')?'right':'antenna');if(id==='orbit-left-deploy')applyCamera('orbitWide',.38);maybeMission();}
  }});
}

function endGesture(x,y){
  if(!gesture)return;const g=gesture,t=g.target;if(snap.active&&t.id===snap.target()?.id){snap.gestureEnd({x,y});if(Math.hypot(x-g.startX,y-g.startY)<18)snap.handleTap({x,y});gesture=null;return;}
  if(t.action==='hold'){holdActive=false;gesture=null;return;}
  if(t.id==='free-left-cycle'){runFreeCycle();gesture=null;return;}
  if(t.id==='free-rotate'){freeRotations++;gesture=null;return;}
  if(g.progress>=.12)animateGestureToOne(t.id,g.progress);gesture=null;
}

renderer.domElement.addEventListener('pointerdown',event=>{
  if(activePointer!==null||event.pointerType==='touch'&&!event.isPrimary)return;activePointer=event.pointerId;renderer.domElement.setPointerCapture?.(event.pointerId);audio.unlock();if(audio.mode==='off'&&phase!=='chooseMission')audio.setMode(phase==='orbit'||phase==='mission'||phase==='complete'?'orbit':'cleanroom');
  const t=chooseTargetAt(event.clientX,event.clientY);if(t)startGesture(t,event.clientX,event.clientY);else audio.tap();
});
renderer.domElement.addEventListener('pointermove',event=>{if(event.pointerId!==activePointer)return;const beforeX=gesture?.lastX??event.clientX;updateCustomGesture(event.clientX,event.clientY);if(gesture?.target.id==='free-rotate'){orbitWorld.satelliteCarrier.rotation.y+=(event.clientX-beforeX)*.006;}});
function pointerEnd(event){if(event.pointerId!==activePointer)return;endGesture(event.clientX,event.clientY);activePointer=null;holdActive=false;}
renderer.domElement.addEventListener('pointerup',pointerEnd);renderer.domElement.addEventListener('pointercancel',pointerEnd);renderer.domElement.addEventListener('lostpointercapture',event=>{if(event.pointerId===activePointer){activePointer=null;holdActive=false;gesture=null;}});

audioToggle.addEventListener('click',event=>{event.stopPropagation();audio.unlock();const muted=audio.toggleMuted();audioToggle.textContent=muted?'×':'♪';audioToggle.setAttribute('aria-pressed',String(muted));audioToggle.setAttribute('aria-label',muted?'おとを だす':'おとを けす');});
replayButton.addEventListener('click',event=>{event.stopPropagation();startGame();});

function updateHold(dt){
  if(!holdActive||!gesture)return;
  if(gesture.target.id==='airflow-hold'){
    game.airShower.progress=clamp01(game.airShower.progress+dt/1.45);world.setAirShower(game.airShower.progress);if(game.airShower.progress>=1){holdActive=false;finishAirShower();}
  }else if(gesture.target.id==='test-hold'){
    game.test.progress=clamp01(game.test.progress+dt/1.65);game.test.lampsLit=Math.min(3,Math.floor(game.test.progress*3.01));world.setTestProgress(game.test.progress);if(game.test.progress>=1){holdActive=false;finishTest();}
  }
}

function updateGuidance(){
  const targets=currentTargets(),idle=elapsed-lastInteraction;if(!targets.length||idle<3.5){guide.style.opacity='0';return;}
  const t=targets[0],cycle=((idle-3.5)%1.75)/1.75,k=t.action==='tap'||t.action==='hold'?0:smooth(Math.min(1,cycle*1.35));const x=THREE.MathUtils.lerp(t.x,t.endX??t.x,k),y=THREE.MathUtils.lerp(t.y,t.endY??t.y,k);
  guide.style.transform=`translate(${x}px,${y}px)`;guide.style.opacity=cycle<.82?'0.82':'0';
}

function basePixelRatio(){
  const pixelBudget=Math.max(1,innerWidth)*Math.max(1,innerHeight);const cap=pixelBudget>1_500_000?1.35:1.65;
  return Math.min(devicePixelRatio||1,cap);
}

function applyRenderSize(){
  const width=Math.max(1,innerWidth),height=Math.max(1,innerHeight);
  renderer.setPixelRatio(basePixelRatio()*renderScale);renderer.setSize(width,height,false);
  (renderer.userData??={}).resolutionScale=+renderScale.toFixed(2);
}

function updateRenderQuality(dt,now){
  if(paused||dt<=0)return;
  frameCostEma=THREE.MathUtils.lerp(frameCostEma,dt,.075);
  if(now<nextQualityCheck)return;nextQualityCheck=now+1400;
  let next=renderScale;
  if(frameCostEma>.042)next=Math.max(.55,renderScale-.15);
  else if(frameCostEma<.025)next=Math.min(1,renderScale+.08);
  if(Math.abs(next-renderScale)<.01)return;renderScale=next;applyRenderSize();
}

function resize(){
  const width=Math.max(1,innerWidth),height=Math.max(1,innerHeight);applyRenderSize();camera.aspect=width/height;camera.updateProjectionMatrix();orbitWorld.setOrientation(portrait());selector.root.scale.setScalar(portrait()?.74:1);
  const shot=phaseShot(phase);if(shot)applyCamera(shot,0);
}
addEventListener('resize',resize,{passive:true});addEventListener('orientationchange',()=>requestAnimationFrame(resize));
document.addEventListener('visibilitychange',()=>{paused=document.hidden;pauseShade.classList.toggle('show',paused);if(paused)audio.suspend();else{lastFrame=performance.now();audio.resume();}});

const spatialValidation={
  issues:[...CLEANROOM_LAYOUT_ISSUES],
  technicianEquipmentCollisions:0,deploymentCollisions:0,capacityOverruns:0,
  collisions:{technicianEquipment:0,panelDeployment:0,total:0},
  capacity:{withinLimits:true,overruns:0},
  layoutStats:CLEANROOM_LAYOUT_STATS,
};

window.__satellite={
  get phase(){return phase;},get busy(){return Boolean(transitionBusy||cameraTween||snap.busy||paused);},targets:()=>currentTargets().map(t=>({...t,path:t.path?.map(p=>({...p}))})),
  get busyReasons(){return{transition:transitionBusy,camera:cameraTween,snap:snap.busy,paused,tweens:tweens.map(t=>t.tag??'game'),elapsed:+elapsed.toFixed(3)};},
  get mission(){return missionId;},get selectedMission(){return missionId;},get planSeed(){return missionPlan?.seed??null;},get planHash(){return missionPlan?.planHash??null;},get phaseHistory(){return[...phaseHistory];},
  get airlock(){return{...game.airlock};},get airShower(){return{...game.airShower};},get integration(){return{...game.integration};},
  get payload(){return{...game.payload,manualIds:[...game.payload.manualIds],planStats:missionPlan?getMissionPlanStats(missionPlan):null};},
  get harness(){return{...game.harness,progress:[...game.harness.progress]};},get blanket(){return{...game.blanket,progress:[...game.blanket.progress]};},
  get arrays(){return{...game.arrays};},get antenna(){return{...game.antenna};},get test(){return{...game.test};},get orbit(){return{...game.orbit};},
  get missionResult(){return{...game.missionResult};},get complete(){return complete;},
  get replay(){return{visible:replayButton.classList.contains('show'),freeCycles,freeRotations,earthTaps};},
  replayNow:()=>startGame(),
  get technicians(){return technicians.stats;},get spatialValidation(){return spatialValidation;},get audio(){return audio.stats;},renderer,
  get installation(){return installation.stats;},get deployables(){return deployables.stats;},get snapIntegration(){return snap.stats();},
  get guidance(){return{idleSeconds:elapsed-lastInteraction,visible:guide.style.opacity!=='0'};},
};

function frame(now){
  requestAnimationFrame(frame);let dt=Math.min(.20,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(paused)dt=0;elapsed+=dt;
  updateRenderQuality(dt,now);
  updateTweens(dt);snap.update(elapsed);updateHold(dt);
  if(world.root.visible)world.update(dt,elapsed);
  if(selector.root.visible)selector.update(elapsed);
  if(technicians.root.visible)technicians.update(dt,elapsed);
  satellite.update(elapsed);installation.update(elapsed);orbitWorld.update(dt,elapsed);updateGuidance();
  camera.lookAt(cameraLook);renderer.render(scene,camera);
}

resize();startGame();requestAnimationFrame(frame);
requestAnimationFrame(()=>{loader.classList.add('gone');setTimeout(()=>loader.remove(),520);});
