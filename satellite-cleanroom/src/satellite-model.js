import * as THREE from 'three';
import { makeWrinkledMLIGeometry } from './materials.js';

function box(w,h,d,material,cast=true){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.castShadow=cast;mesh.receiveShadow=true;return mesh;
}

function glowDot(material,scale=.09){
  const dot=new THREE.Mesh(new THREE.SphereGeometry(scale,12,8),material.clone());dot.material.emissiveIntensity=.18;return dot;
}

export class SatelliteModel {
  constructor(materials, glowTexture) {
    this.materials=materials;this.glowTexture=glowTexture;
    this.root=new THREE.Group();this.root.name='SatelliteBus';
    this.mission=null;this.payloadModules=[];this.payloadInstalled=0;
    this.cableProgress=[0,0,0];this.cablesConnected=0;
    this.blanketProgress=[0,0,0];this.blanketsInstalled=0;
    this._buildBus();this._buildCables();this._buildBlankets();
  }

  _buildBus(){
    const m=this.materials;
    this.busShell=new THREE.Group();this.root.add(this.busShell);
    const core=box(2.3,2.45,2.24,m.aluminium);core.name='PaintedAluminiumBus';this.busShell.add(core);
    // Structural corner rails and face seams create real assembly scale.
    for(const x of [-1.17,1.17])for(const z of [-1.14,1.14]){
      const rail=box(.12,2.58,.12,m.rail);rail.position.set(x,0,z);this.busShell.add(rail);
    }
    for(const y of [-1.23,1.23]){
      const top=box(2.4,.1,2.34,m.aluminiumDark);top.position.y=y;this.busShell.add(top);
    }
    const radiator=box(1.72,1.38,.065,m.blackRadiator);radiator.position.set(0,.05,-1.153);this.busShell.add(radiator);
    for(let i=0;i<6;i++){
      const fin=box(1.58,.022,.028,m.rail,false);fin.position.set(0,-.52+i*.21,-1.194);this.busShell.add(fin);
    }
    this.accentMaterial=new THREE.MeshStandardMaterial({color:0x3ca0ca,roughness:.48,metalness:.28});
    this.accentStrips=[];
    for(const x of [-.78,.78]){
      const strip=box(.16,2.02,.035,this.accentMaterial,false);strip.position.set(x,0,1.135);this.busShell.add(strip);this.accentStrips.push(strip);
    }
    const topDeck=new THREE.Mesh(new THREE.CylinderGeometry(.78,.84,.16,24),m.aluminiumDark);topDeck.position.y=1.34;this.busShell.add(topDeck);
    this.topDeck=topDeck;
    this.statusLights=[];
    for(let i=0;i<3;i++){const light=glowDot(m.cyanGlow,.075);light.position.set(-.28+i*.28,.83,1.18);this.busShell.add(light);this.statusLights.push(light);}

    // Lifting fixture makes crane attachment explicit.
    const liftRing=new THREE.Mesh(new THREE.TorusGeometry(.28,.055,8,20),m.rail);liftRing.position.y=1.61;liftRing.rotation.x=Math.PI/2;this.busShell.add(liftRing);
    this.attachmentGroup=new THREE.Group();this.root.add(this.attachmentGroup);
  }

  setMission(mission){
    this.mission=mission;
    this.accentMaterial.color.setHex(mission.busAccent);
    this._disposePayloadModules();
    const slots=[
      {position:new THREE.Vector3(0,.16,1.31),rotation:new THREE.Euler(0,0,0),id:mission.mainInstrumentId,primary:true},
      {position:new THREE.Vector3(-1.29,-.52,.38),rotation:new THREE.Euler(0,0,-Math.PI/2),id:'guidance-box'},
      {position:new THREE.Vector3(1.28,.5,-.2),rotation:new THREE.Euler(0,0,Math.PI/2),id:'power-controller'},
    ];
    slots.forEach((slot,index)=>{
      const group=index===0?this._makeMissionInstrument(mission):this._makeCommonModule(index,mission);
      group.name=slot.id;group.visible=false;
      this.payloadModules.push({...slot,index,group,installed:false});
    });
    return this.payloadModules;
  }

  _makeMissionInstrument(mission){
    const g=new THREE.Group(),m=this.materials;
    const accent=new THREE.MeshStandardMaterial({color:mission.busAccent,roughness:.43,metalness:.36});
    g.userData.ownedMaterials=[accent];
    if(mission.id==='weather'){
      const body=box(1.18,.92,.62,m.aluminiumDark);g.add(body);
      const hood=new THREE.Mesh(new THREE.CylinderGeometry(.35,.44,.56,24),m.blackRadiator);hood.rotation.x=Math.PI/2;hood.position.z=.54;g.add(hood);
      const lens=new THREE.Mesh(new THREE.CylinderGeometry(.27,.27,.035,24),m.glass);lens.rotation.x=Math.PI/2;lens.position.z=.84;g.add(lens);
      const stripe=box(.82,.11,.64,accent);stripe.position.y=.31;g.add(stripe);
    }else if(mission.id==='ocean'){
      const body=box(1.46,.48,.72,m.aluminiumDark);g.add(body);
      for(const x of [-.48,0,.48]){const sensor=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.42,20),m.blackRadiator);sensor.rotation.x=Math.PI/2;sensor.position.set(x,0,.48);g.add(sensor);const ring=new THREE.Mesh(new THREE.TorusGeometry(.2,.035,8,20),accent);ring.position.set(x,0,.7);g.add(ring);}
      const wing=box(1.55,.08,.86,accent);wing.position.y=-.29;g.add(wing);
    }else{
      const base=new THREE.Mesh(new THREE.CylinderGeometry(.55,.7,.5,24),m.aluminiumDark);base.rotation.x=Math.PI/2;g.add(base);
      const feeds=[];for(const x of [-.29,.29]){const f=new THREE.Mesh(new THREE.CylinderGeometry(.13,.18,.56,16),accent);f.rotation.x=Math.PI/2;f.position.set(x,0,.42);g.add(f);feeds.push(f);}
      const brace=box(1.25,.18,.5,m.rail);brace.position.z=-.18;g.add(brace);
    }
    return g;
  }

  _makeCommonModule(index,mission){
    const g=new THREE.Group(),m=this.materials;
    const accent=new THREE.MeshStandardMaterial({color:mission.busAccent,roughness:.5,metalness:.26});
    g.userData.ownedMaterials=[accent];
    if(index===1){
      const body=box(.92,.76,.48,m.aluminiumDark);g.add(body);
      for(let i=0;i<4;i++){const rib=box(.76,.035,.52,accent,false);rib.position.y=-.25+i*.17;g.add(rib);}
      const dot=glowDot(m.cyanGlow,.08);dot.position.set(.3,.2,.27);g.add(dot);g.userData.status=dot;
    }else{
      const body=box(.88,.8,.5,m.aluminium);g.add(body);
      const black=box(.62,.54,.035,m.blackRadiator,false);black.position.z=.27;g.add(black);
      for(let i=0;i<3;i++){const dot=glowDot(i===2?m.greenGlow:m.cyanGlow,.055);dot.position.set(-.2+i*.2,.13,.3);g.add(dot);if(i===1)g.userData.status=dot;}
    }
    return g;
  }

  showPayloadOnRack(index,parent,position){
    const item=this.payloadModules[index];if(!item)return null;
    parent.add(item.group);item.group.visible=true;item.group.position.copy(position);item.group.rotation.set(0,0,0);item.group.scale.setScalar(1);return item.group;
  }

  installPayload(index){
    const item=this.payloadModules[index];if(!item||item.installed)return;
    this.attachmentGroup.attach(item.group);item.group.position.copy(item.position);item.group.rotation.copy(item.rotation);item.group.scale.setScalar(1);item.installed=true;
    this.payloadInstalled=this.payloadModules.filter(v=>v.installed).length;
    const status=item.group.userData.status;if(status)status.material.emissiveIntensity=1.6;
    this.statusLights[Math.min(index,2)].material.emissiveIntensity=1.35;
  }

  _buildCables(){
    const mats=[this.materials.cableBlue,this.materials.cableOrange,this.materials.cableGreen];
    this.cableRoutes=[
      [new THREE.Vector3(-.86,.7,1.2),new THREE.Vector3(-.25,.92,1.23),new THREE.Vector3(.28,.62,1.23),new THREE.Vector3(.68,.28,1.23)],
      [new THREE.Vector3(-1.2,-.45,.58),new THREE.Vector3(-.78,-.72,1.18),new THREE.Vector3(-.08,-.66,1.23),new THREE.Vector3(.47,-.4,1.23)],
      [new THREE.Vector3(1.2,.46,.15),new THREE.Vector3(.85,.72,1.18),new THREE.Vector3(.24,.45,1.23),new THREE.Vector3(-.18,.16,1.23)],
    ];
    this.cableGroups=[];this.cableTips=[];
    this.cableRoutes.forEach((points,index)=>{
      const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
      const g=new THREE.Group();this.root.add(g);
      // A broad, permanent routing groove gives a preschooler a forgiving line
      // to follow before the coloured harness is laid into it.
      const grooveMaterial=new THREE.MeshStandardMaterial({color:0x586a70,roughness:.84,metalness:.16});
      const groove=new THREE.Mesh(new THREE.TubeGeometry(curve,28,.060,8,false),grooveMaterial);
      groove.name=`CableGroove${index+1}`;groove.receiveShadow=true;g.add(groove);
      // One indexed tube replaces eighteen individual cylinder draw calls. Its
      // draw range grows along the same forgiving spline while the child traces.
      const cableGeometry=new THREE.TubeGeometry(curve,36,.045,9,false);
      const cable=new THREE.Mesh(cableGeometry,mats[index]);
      const cableIndexCount=cableGeometry.index?.count??cableGeometry.attributes.position.count;
      cable.name=`CableHarness${index+1}`;cable.castShadow=true;cable.visible=false;
      cableGeometry.setDrawRange(0,0);g.add(cable);
      const connector=box(.2,.16,.12,this.materials.aluminiumDark);connector.position.copy(points.at(-1));connector.visible=false;g.add(connector);
      const tip=glowDot(this.materials.cyanGlow,.09);tip.position.copy(points[0]);tip.visible=false;g.add(tip);
      this.cableGroups.push({group:g,groove,cable,cableIndexCount,connector,curve,tip});this.cableTips.push(tip);
    });
  }

  setCableProgress(index,progress){
    const p=THREE.MathUtils.clamp(progress,0,1);this.cableProgress[index]=Math.max(this.cableProgress[index],p);
    const cable=this.cableGroups[index];if(!cable)return;
    const tubularSegments=36;
    const visibleSegments=Math.ceil(tubularSegments*this.cableProgress[index]);
    cable.cable.geometry.setDrawRange(0,Math.min(cable.cableIndexCount,visibleSegments*9*6));
    cable.cable.visible=this.cableProgress[index]>0;
    cable.connector.visible=p>=.96;cable.group.visible=p>0;
    cable.group.updateMatrixWorld(true);
    const local=cable.curve.getPoint(this.cableProgress[index]);cable.tip.position.copy(local);cable.tip.visible=p>0&&p<1;
    if(p>=1){cable.tip.visible=false;if(this.cableProgress.filter(v=>v>=1).length>this.cablesConnected)this.cablesConnected++;}
  }

  setHarnessGuidesVisible(visible){
    this.cableGroups.forEach(cable=>{cable.group.visible=Boolean(visible);cable.groove.visible=Boolean(visible);});
  }

  pulseCable(index,time){
    const cable=this.cableGroups[index];if(!cable)return;
    const p=(time%1);cable.tip.visible=true;cable.tip.position.copy(cable.curve.getPoint(p));
    cable.tip.scale.setScalar(.75+Math.sin(p*Math.PI)*.55);
    if(p>.97)cable.tip.visible=false;
  }

  _buildBlankets(){
    const placements=[
      {pos:new THREE.Vector3(0,-.2,1.185),rot:new THREE.Euler(0,0,0),size:[2.08,1.72]},
      {pos:new THREE.Vector3(-1.185,-.05,0),rot:new THREE.Euler(0,-Math.PI/2,0),size:[2.0,1.78]},
      {pos:new THREE.Vector3(1.185,-.05,0),rot:new THREE.Euler(0,Math.PI/2,0),size:[2.0,1.78]},
    ];
    this.blankets=[];
    placements.forEach((placement,index)=>{
      const g=new THREE.Group();g.position.copy(placement.pos);g.rotation.copy(placement.rot);g.visible=false;this.root.add(g);
      const mesh=new THREE.Mesh(makeWrinkledMLIGeometry(...placement.size,index+3),this.materials.mli);mesh.castShadow=true;mesh.morphTargetInfluences[0]=1;g.add(mesh);
      const fastenerGeo=new THREE.CylinderGeometry(.055,.055,.025,12);const capacity=6;
      const fasteners=new THREE.InstancedMesh(fastenerGeo,this.materials.aluminiumDark,capacity);fasteners.rotation.x=Math.PI/2;fasteners.count=0;fasteners.frustumCulled=false;g.add(fasteners);
      const positions=[[-.86,-.64],[0,-.7],[.86,-.64],[-.86,.64],[0,.7],[.86,.64]];const dummy=new THREE.Object3D();
      positions.forEach(([x,y],i)=>{dummy.position.set(x,y,.04);dummy.updateMatrix();fasteners.setMatrixAt(i,dummy.matrix);});fasteners.instanceMatrix.needsUpdate=true;
      this.blankets.push({group:g,mesh,fasteners,installed:false});
    });
  }

  showBlanket(index){const b=this.blankets[index];if(b){b.group.visible=true;b.mesh.morphTargetInfluences[0]=1;b.fasteners.count=0;}}
  setBlanketProgress(index,progress){
    const b=this.blankets[index];if(!b)return;const p=THREE.MathUtils.clamp(progress,0,1);this.blanketProgress[index]=Math.max(this.blanketProgress[index],p);b.group.visible=true;
    b.mesh.morphTargetInfluences[0]=1-this.blanketProgress[index];b.fasteners.count=Math.min(6,Math.floor(Math.max(0,p-.56)/.44*7));
    if(p>=1&&!b.installed){b.installed=true;this.blanketsInstalled++;b.fasteners.count=6;}
  }

  reset(){
    this._disposePayloadModules();this.mission=null;
    this.cableProgress=[0,0,0];this.cablesConnected=0;this.cableGroups.forEach(c=>{c.group.visible=false;c.groove.visible=false;c.cable.visible=false;c.cable.geometry.setDrawRange(0,0);c.connector.visible=false;c.tip.visible=false;});
    this.blanketProgress=[0,0,0];this.blanketsInstalled=0;this.blankets.forEach(b=>{b.group.visible=false;b.installed=false;b.mesh.morphTargetInfluences[0]=1;b.fasteners.count=0;});
    this.statusLights.forEach(l=>l.material.emissiveIntensity=.18);
  }

  _disposePayloadModules(){
    this.payloadModules.forEach((item)=>{
      item.group.removeFromParent();item.installed=false;
      item.group.traverse((object)=>object.geometry?.dispose?.());
      item.group.userData.ownedMaterials?.forEach((material)=>material.dispose?.());
    });
    this.payloadModules=[];this.payloadInstalled=0;
  }

  update(time){
    this.statusLights.forEach((light,i)=>{if(i<this.payloadInstalled)light.scale.setScalar(1+Math.sin(time*5+i)*.08);});
  }

  get stats(){
    return {
      mission:this.mission?.id??null,
      mainInstrumentId:this.mission?.mainInstrumentId??null,
      manualInstalled:this.payloadInstalled,total:this.payloadModules.length,
      manualIds:this.payloadModules.filter(v=>v.installed).map(v=>v.id),
      manualVisible:this.payloadModules.filter(v=>v.installed&&v.group.visible).length,
      harness:{connected:this.cablesConnected,total:this.cableGroups.length,progress:[...this.cableProgress]},
      blanket:{installed:this.blanketsInstalled,total:this.blankets.length,progress:[...this.blanketProgress]},
    };
  }
}
