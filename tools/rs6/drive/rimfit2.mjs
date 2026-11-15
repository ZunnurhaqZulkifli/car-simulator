// the rim's own plane (PCA) and circle (Kasa), iterated on the leather/interior points in a band about the current guess
import { readGlb, meshNodes } from './glb.mjs';
const { json, bin } = readGlb(process.argv[2]), L = +process.argv[3], nodes = meshNodes(json, bin);
const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of nodes) for (const p of n.prims) for (let v = 0; v < p.pos.length; v += 3) for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], p.pos[v + k]); B[k + 3] = Math.max(B[k + 3], p.pos[v + k]); }
const k = L / (B[5] - B[2]), car = (x, y, z) => [(x - (B[0] + B[3]) / 2) * k, (y - B[1]) * k, (z - (B[2] + B[5]) / 2) * k];
const pts = []; for (const nd of nodes) if (/InteriorTilling_Geo|Interior_Geo/.test(nd.name)) for (const p of nd.prims) for (let v = 0; v < p.pos.length; v += 3) pts.push(car(p.pos[v], p.pos[v+1], p.pos[v+2]));
let C = [0.3841, 0.8888, 0.4858], N = [0.024, -0.676, 0.737], R = 0.17;
const basis = N => { const U = [1, 0, 0].map((v, i) => v - N[0]*N[i]), ul = Math.hypot(...U); for (let i = 0; i < 3; i++) U[i] /= ul; return [U, [N[1]*U[2]-N[2]*U[1], N[2]*U[0]-N[0]*U[2], N[0]*U[1]-N[1]*U[0]]]; };
for (let it = 0; it < 12; it++) {
  const [U, V] = basis(N), band = it < 3 ? 0.035 : 0.022;
  const sel = pts.filter(q => { const d = q.map((v, i) => v - C[i]), h = d[0]*N[0]+d[1]*N[1]+d[2]*N[2], r = Math.sqrt(Math.max(0, d[0]**2+d[1]**2+d[2]**2-h*h)); return Math.abs(h) < 0.05 && Math.abs(r - R) < band; });
  // plane: PCA of the band
  const c = [0,1,2].map(i => sel.reduce((s, q) => s + q[i], 0)/sel.length), M = [[0,0,0],[0,0,0],[0,0,0]];
  for (const q of sel) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += (q[i]-c[i])*(q[j]-c[j]);
  const tr = M[0][0]+M[1][1]+M[2][2]; let a = N.slice(); for (let t = 0; t < 100; t++){ const b = M.map((row, i) => tr*a[i] - row[0]*a[0]-row[1]*a[1]-row[2]*a[2]), l = Math.hypot(...b); a = b.map(x => x/l); }
  if (a[2] < 0) a = a.map(x => -x); N = a;
  const [U2, V2] = basis(N);
  let su=0,sw=0,suu=0,sww=0,suw=0,suz=0,swz=0,sz=0; const n = sel.length;
  const uv = sel.map(q => { const d = q.map((v, i) => v - C[i]); return [d[0]*U2[0]+d[1]*U2[1]+d[2]*U2[2], d[0]*V2[0]+d[1]*V2[1]+d[2]*V2[2], d[0]*N[0]+d[1]*N[1]+d[2]*N[2]]; });
  let hm = 0; for (const [u,w,h] of uv){ const z=u*u+w*w; su+=u;sw+=w;suu+=u*u;sww+=w*w;suw+=u*w;suz+=u*z;swz+=w*z;sz+=z; hm+=h; }
  const MM=[[suu,suw,su,suz],[suw,sww,sw,swz],[su,sw,n,sz]];
  for(let i=0;i<3;i++){ let pv=i; for(let kk=i+1;kk<3;kk++) if(Math.abs(MM[kk][i])>Math.abs(MM[pv][i])) pv=kk; [MM[i],MM[pv]]=[MM[pv],MM[i]]; for(let kk=0;kk<3;kk++) if(kk!==i){ const ff=MM[kk][i]/MM[i][i]; for(let j=i;j<4;j++) MM[kk][j]-=ff*MM[i][j]; } }
  const cu=MM[0][3]/MM[0][0]/2, cw=MM[1][3]/MM[1][1]/2; R = Math.sqrt(MM[2][3]/MM[2][2]+cu*cu+cw*cw);
  C = C.map((v, i) => v + cu*U2[i] + cw*V2[i] + (hm/n)*N[i]);
  const res = uv.map(([u,w]) => Math.hypot(u-cu, w-cw) - R);
  console.log(`it ${it} n ${n} C ${C.map(v=>v.toFixed(4))} N ${N.map(v=>v.toFixed(3))} R ${R.toFixed(4)} rms ${Math.sqrt(res.reduce((s,x)=>s+x*x,0)/n).toFixed(4)} tilt ${(Math.atan2(-N[1], N[2])*180/Math.PI).toFixed(1)}°`);
}
