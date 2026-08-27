import * as THREE from 'three';

function box(w,h,d,material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}

function makeArc(points,color=0x62d7ff,opacity=.75){
  const curve=new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve,32,.035,7,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false}));
}

function makeEarthTexture(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const ctx=canvas.getContext('2d');
  const ocean=ctx.createLinearGradient(0,0,0,256);ocean.addColorStop(0,'#1d8fc2');ocean.addColorStop(.55,'#17699a');ocean.addColorStop(1,'#0d456d');ctx.fillStyle=ocean;ctx.fillRect(0,0,512,256);
  ctx.fillStyle='#559c68';
  const blobs=[
    [65,72,86,46,-.2],[154,142,52,82,.18],[260,63,105,48,.08],[317,143,48,74,-.25],[408,95,72,42,.26],[480,160,57,34,-.1],
  ];
  blobs.forEach(([x,y,rx,ry,rot])=>{ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.beginPath();for(let i=0;i<18;i++){const a=i/18*Math.PI*2;const wobble=1+Math.sin(i*3.7+x)*.13;const px=Math.cos(a)*rx*wobble,py=Math.sin(a)*ry*(1+Math.cos(i*2.3)*.09);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();ctx.restore();});
  ctx.fillStyle='rgba(228,241,211,.38)';ctx.fillRect(0,15,512,12);ctx.fillRect(0,230,512,17);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}

export class MissionSelector {
  constructor(materials,glowTexture){
    this.materials=materials;this.root=new THREE.Group();this.root.name='MissionChoice';this.cards=[];this.selected=null;
    const defs=[
      {id:'weather',x:-3.15,color:0x5aa8d6},
      {id:'ocean',x:0,color:0x3eb4a0},
      {id:'communication',x:3.15,color:0xe6944b},
    ];
    defs.forEach((def,index)=>this._makeCard(def,index,glowTexture));
  }

  _makeCard(def,index,glowTexture){
    const g=new THREE.Group();g.position.set(def.x,0,0);this.root.add(g);
    const accent=new THREE.MeshStandardMaterial({color:def.color,roughness:.48,metalness:.2});
    const base=box(2.55,.32,2.15,this.materials.aluminium);base.position.y=.12;g.add(base);
    const back=box(2.55,3.2,.18,this.materials.aluminium);back.position.set(0,1.8,.98);g.add(back);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.92,.08,10,36),accent);rim.position.set(0,1.92,.84);g.add(rim);
    const globe=new THREE.Mesh(new THREE.SphereGeometry(.72,28,18),new THREE.MeshStandardMaterial({color:0x3189b4,roughness:.7,metalness:.05}));globe.position.set(0,1.92,.82);g.add(globe);
    if(def.id==='weather'){
      const cloudMat=this.materials.cloud;for(const [x,y,s] of [[-.4,.12,.28],[-.08,.26,.36],[.28,.14,.3],[.45,-.08,.22]]){const c=new THREE.Mesh(new THREE.SphereGeometry(s,14,10),cloudMat);c.position.set(x,1.95+y,1.36);g.add(c);}
      const swirl=new THREE.Mesh(new THREE.TorusGeometry(.48,.035,8,32,Math.PI*1.55),new THREE.MeshBasicMaterial({color:0xffffff}));swirl.position.set(0,1.82,1.55);swirl.rotation.z=.2;g.add(swirl);
    }else if(def.id==='ocean'){
      for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.54-i*.1,.035,8,32,Math.PI*1.4),new THREE.MeshBasicMaterial({color:[0x7ff0df,0x55d7ee,0xb0f4ff][i]}));ring.position.set(0,1.92,1.48+i*.015);ring.rotation.z=-.7+i*.45;g.add(ring);}
      const ice=box(.65,.08,.24,new THREE.MeshStandardMaterial({color:0xeaffff,roughness:.9}));ice.position.set(-.22,2.42,1.35);ice.rotation.z=.2;g.add(ice);
    }else{
      for(const x of [-.46,.46]){const island=new THREE.Mesh(new THREE.CylinderGeometry(.23,.3,.13,12),new THREE.MeshStandardMaterial({color:0x70aa67,roughness:.9}));island.position.set(x,1.55,1.43);island.rotation.x=Math.PI/2;g.add(island);}
      const arc=makeArc([new THREE.Vector3(-.47,1.68,1.44),new THREE.Vector3(0,2.45,1.62),new THREE.Vector3(.47,1.68,1.44)],0x8ff2ff,1);g.add(arc);
      const ship=box(.32,.14,.16,this.materials.aluminiumDark);ship.position.set(0,1.33,1.52);g.add(ship);
    }
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:def.color,transparent:true,opacity:.28,depthWrite:false,blending:THREE.AdditiveBlending}));halo.position.set(0,1.9,.65);halo.scale.set(2.8,2.8,1);g.add(halo);
    this.cards.push({id:def.id,index,group:g,halo,baseY:g.position.y,preview:0});
  }

  select(id){this.selected=id;this.cards.forEach(card=>{card.preview=card.id===id?1:0;});}
  reset(){this.selected=null;this.cards.forEach(c=>{c.preview=0;c.group.scale.setScalar(1);});}
  update(time){
    this.cards.forEach((card,index)=>{
      const active=card.id===this.selected;const target=active?1.1:1;
      card.group.scale.lerp(new THREE.Vector3(target,target,target),.1);
      card.group.position.y=card.baseY+Math.sin(time*1.7+index*.9)*.035+(active?Math.sin(time*4)*.035:0);
      card.halo.material.opacity=active?.64:.25+.08*Math.sin(time*2+index);
    });
  }
}

export class OrbitWorld {
  constructor(scene,materials,glowTexture){
    this.scene=scene;this.materials=materials;this.glowTexture=glowTexture;this.root=new THREE.Group();this.root.name='Orbit';this.root.visible=false;scene.add(this.root);
    this.mission=null;this.resultVisible=false;this.signalCount=0;this._signals=[];this._resultGroup=new THREE.Group();this.root.add(this._resultGroup);
    this._buildSpace();this._buildEarth();
    this.satelliteCarrier=new THREE.Group();this.satelliteCarrier.position.set(2.85,1.5,1.15);this.root.add(this.satelliteCarrier);
  }

  _buildSpace(){
    const geo=new THREE.BufferGeometry();const count=700;const pos=new Float32Array(count*3),sizes=new Float32Array(count);
    for(let i=0;i<count;i++){const u=((i*97)%701)/701,v=((i*193)%709)/709,w=((i*389)%719)/719;const r=26+u*52;const theta=v*Math.PI*2,phi=Math.acos(2*w-1);pos[i*3]=r*Math.sin(phi)*Math.cos(theta);pos[i*3+1]=r*Math.cos(phi);pos[i*3+2]=r*Math.sin(phi)*Math.sin(theta);sizes[i]=.5+u;}
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const stars=new THREE.Points(geo,new THREE.PointsMaterial({color:0xd9f2ff,size:.09,sizeAttenuation:true,transparent:true,opacity:.88}));this.root.add(stars);this.stars=stars;
  }

  _buildEarth(){
    this.earth=new THREE.Group();this.earth.position.set(-2.5,-1.45,-1.2);this.root.add(this.earth);
    const mat=new THREE.MeshStandardMaterial({map:makeEarthTexture(),roughness:.84,metalness:.02});
    this.globe=new THREE.Mesh(new THREE.SphereGeometry(3.45,48,32),mat);this.globe.receiveShadow=true;this.earth.add(this.globe);
    const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(3.55,40,28),new THREE.MeshBasicMaterial({color:0x55bde9,transparent:true,opacity:.11,side:THREE.BackSide,blending:THREE.AdditiveBlending}));this.earth.add(atmosphere);
    const rim=new THREE.Mesh(new THREE.SphereGeometry(3.62,40,28),new THREE.MeshBasicMaterial({color:0x6ed5ff,transparent:true,opacity:.08,side:THREE.BackSide}));this.earth.add(rim);
    this.earthTargets=[];
  }

  setMission(mission){
    this.mission=mission;this.resultVisible=false;this.signalCount=0;
    this._signals.forEach((beam)=>this._disposeSignal(beam));this._signals=[];
    this._clearResult();
    this.earthTargets=[];
    if(mission.id==='weather')this._buildWeatherResult();else if(mission.id==='ocean')this._buildOceanResult();else this._buildCommunicationResult();
    this._resultGroup.visible=false;
  }

  _buildWeatherResult(){
    const cloudMat=this.materials.cloud;const globeLocal=this.earth.position.clone();
    const swirl=new THREE.Group();swirl.position.copy(globeLocal);this._resultGroup.add(swirl);
    const cloudGeometry=new THREE.SphereGeometry(1,10,7);
    const clouds=new THREE.InstancedMesh(cloudGeometry,cloudMat,44);
    const matrix=new THREE.Matrix4();
    const position=new THREE.Vector3();
    const quaternion=new THREE.Quaternion();
    const scale=new THREE.Vector3();
    for(let i=0;i<44;i++){
      const a=i*.56,r=.3+i*.046,size=.13+(i%4)*.018;
      position.set(Math.cos(a)*r,.35+Math.sin(i*.38)*.12,Math.sin(a)*r+3.18);
      scale.set(size*1.7,size*.7,size);
      matrix.compose(position,quaternion,scale);
      clouds.setMatrixAt(i,matrix);
    }
    clouds.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    clouds.instanceMatrix.needsUpdate=true;
    swirl.add(clouds);
    const rainMat=new THREE.MeshBasicMaterial({color:0x5fcbff,transparent:true,opacity:.72});
    const rain=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),rainMat,10);
    for(let i=0;i<10;i++){
      position.set(-.65+i*.14,-.22-(i%3)*.08,3.22);
      scale.set(.025,.28,.025);
      matrix.compose(position,quaternion,scale);
      rain.setMatrixAt(i,matrix);
    }
    rain.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    rain.instanceMatrix.needsUpdate=true;
    swirl.add(rain);
    this.earthTargets=[new THREE.Vector3(-2.5,-1.0,2.1)];
  }

  _buildOceanResult(){
    const center=this.earth.position.clone();const colors=[0x62f0db,0x52c9ff,0xb5f3ff,0x2e9bdd];
    for(let i=0;i<7;i++){const y=-2.45+i*.38;const radius=Math.sqrt(Math.max(.2,3.55*3.55-(y+1.45)*(y+1.45)))*.96;const curve=new THREE.EllipseCurve(0,0,radius,radius*.22,.15,Math.PI*1.7,false,i*.42);const pts=curve.getPoints(40).map(p=>new THREE.Vector3(center.x+p.x,y,center.z+3.28+p.y));const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:colors[i%colors.length],transparent:true,opacity:.84}));this._resultGroup.add(line);}
    const iceMat=new THREE.MeshStandardMaterial({color:0xe9ffff,roughness:.88});
    const ice=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),iceMat,9);
    const matrix=new THREE.Matrix4();
    const position=new THREE.Vector3();
    const quaternion=new THREE.Quaternion();
    const scale=new THREE.Vector3();
    const euler=new THREE.Euler();
    for(let i=0;i<9;i++){
      position.set(center.x-1.1+i*.28,1.18+Math.sin(i)*.08,center.z+2.45+Math.cos(i)*.2);
      euler.set(0,i*.7,0);quaternion.setFromEuler(euler);
      scale.set(.35+(i%3)*.11,.05,.22+(i%2)*.1);
      matrix.compose(position,quaternion,scale);
      ice.setMatrixAt(i,matrix);
    }
    ice.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    ice.instanceMatrix.needsUpdate=true;
    this._resultGroup.add(ice);
    this.earthTargets=[new THREE.Vector3(-2.5,-.4,2.0)];
  }

  _buildCommunicationResult(){
    const targetDefs=[[-4.15,-.5,1.7],[-1.0,-2.5,1.85],[-3.0,.52,1.52],[.1,-.9,.9]];
    const sat=new THREE.Vector3(2.45,1.05,1.25);
    const dots=new THREE.InstancedMesh(new THREE.SphereGeometry(.11,12,8),this.materials.cyanGlow,targetDefs.length);
    const matrix=new THREE.Matrix4();
    targetDefs.forEach((p,i)=>{const target=new THREE.Vector3(...p);const mid=sat.clone().lerp(target,.55);mid.y+=1.7+i*.18;const arc=makeArc([sat,mid,target],i===3?0xffd06d:0x73e5ff,.86);this._resultGroup.add(arc);matrix.makeTranslation(target.x,target.y,target.z);dots.setMatrixAt(i,matrix);});
    dots.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    dots.instanceMatrix.needsUpdate=true;
    this._resultGroup.add(dots);
    this.earthTargets=targetDefs.map(p=>new THREE.Vector3(...p));
  }

  showResult(){this.resultVisible=true;this._resultGroup.visible=true;}
  sendSignal(){
    this.signalCount++;
    const beam=makeArc([
      new THREE.Vector3(2.6,1.45,1.1),new THREE.Vector3(.4,2.3,.8),this.earthTargets[this.signalCount%Math.max(1,this.earthTargets.length)]??new THREE.Vector3(-2,-.5,2),
    ],0xb7f5ff,1);beam.userData.life=1;this.root.add(beam);this._signals.push(beam);
  }

  _disposeSignal(beam){
    beam.removeFromParent();
    beam.geometry?.dispose?.();
    beam.material?.dispose?.();
  }

  _clearResult(){
    const sharedMaterials=new Set(Object.values(this.materials));
    while(this._resultGroup.children.length){
      const child=this._resultGroup.children[0];
      child.traverse((object)=>{
        object.geometry?.dispose?.();
        const owned=Array.isArray(object.material)?object.material:[object.material];
        owned.filter(Boolean).forEach((material)=>{if(!sharedMaterials.has(material))material.dispose?.();});
      });
      this._resultGroup.remove(child);
    }
  }

  setOrientation(portrait){
    if(portrait){this.earth.position.set(-.35,-3.1,-1.2);this.satelliteCarrier.position.set(0,2.35,1.1);this.satelliteCarrier.rotation.z=Math.PI/2;}
    else{this.earth.position.set(-2.5,-1.45,-1.2);this.satelliteCarrier.position.set(2.85,1.5,1.15);this.satelliteCarrier.rotation.z=0;}
  }

  setVisible(visible){this.root.visible=visible;}
  update(dt,time){
    if(!this.root.visible)return;
    this.globe.rotation.y+=dt*.045;this.stars.rotation.y+=dt*.003;
    this._resultGroup.rotation.y=Math.sin(time*.1)*.025;
    for(let i=this._signals.length-1;i>=0;i--){const beam=this._signals[i];beam.userData.life-=dt*1.2;beam.material.opacity=Math.max(0,beam.userData.life);beam.scale.setScalar(1+(1-beam.userData.life)*.045);if(beam.userData.life<=0){this._disposeSignal(beam);this._signals.splice(i,1);}}
  }

  get resultKind(){return this.mission?.resultKind??null;}
  get stats(){return{active:this.root.visible,mission:this.mission?.id??null,resultKind:this.resultKind,resultVisible:this.resultVisible,signalCount:this.signalCount,earthTargets:this.earthTargets.length};}
}
