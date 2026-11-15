import fs from 'fs';
export function ppm(file){
  const buf = fs.readFileSync(file); let off = 0; const tok = [];
  while (tok.length < 4) { while (/\s/.test(String.fromCharCode(buf[off]))) off++; let s=''; while (!/\s/.test(String.fromCharCode(buf[off]))) s += String.fromCharCode(buf[off++]); tok.push(s); }
  off++; const W = +tok[1], H = +tok[2];
  const px = (x, y) => { x = Math.round(x); y = Math.round(y); if (x<0||y<0||x>=W||y>=H) return [0,0,0]; const i = off + (y*W + x)*3; return [buf[i], buf[i+1], buf[i+2]]; };
  const bil = (x, y, c) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x-x0, fy = y-y0, g = (xx,yy) => { if(xx<0||yy<0||xx>=W||yy>=H) return 0; return buf[off+(yy*W+xx)*3+c]; };
    return g(x0,y0)*(1-fx)*(1-fy)+g(x0+1,y0)*fx*(1-fy)+g(x0,y0+1)*(1-fx)*fy+g(x0+1,y0+1)*fx*fy; };
  const lum = (x, y) => 0.3*bil(x,y,0) + 0.59*bil(x,y,1) + 0.11*bil(x,y,2);
  return { W, H, px, bil, lum };
}
// solve n x n linear system
export function solve(A, b){ const n = b.length, M = A.map((r,i)=>[...r, b[i]]);
  for (let i=0;i<n;i++){ let p=i; for(let k=i+1;k<n;k++) if(Math.abs(M[k][i])>Math.abs(M[p][i])) p=k; [M[i],M[p]]=[M[p],M[i]];
    for(let k=i+1;k<n;k++){ const f=M[k][i]/M[i][i]; for(let j=i;j<=n;j++) M[k][j]-=f*M[i][j]; } }
  const x = Array(n).fill(0); for(let i=n-1;i>=0;i--){ let s=M[i][n]; for(let j=i+1;j<n;j++) s-=M[i][j]*x[j]; x[i]=s/M[i][i]; } return x; }
// circle fit (Kasa)
export function circle(pts){ let A=[[0,0,0],[0,0,0],[0,0,0]], b=[0,0,0];
  for (const [x,y] of pts){ const r=[x,y,1], z=x*x+y*y; for(let i=0;i<3;i++){ b[i]+=r[i]*z; for(let j=0;j<3;j++) A[i][j]+=r[i]*r[j]; } }
  const [a,bb,c] = solve(A,b), cx=a/2, cy=bb/2, R=Math.sqrt(c+cx*cx+cy*cy);
  const rms = Math.sqrt(pts.reduce((s,[x,y])=>s+(Math.hypot(x-cx,y-cy)-R)**2,0)/pts.length); return { cx, cy, R, rms }; }
// ellipse: x^2 + B xy + C y^2 + D x + E y + F = 0 (A fixed 1)
export function ellipse(pts){ let A=Array.from({length:5},()=>Array(5).fill(0)), b=Array(5).fill(0);
  for (const [x,y] of pts){ const r=[x*y, y*y, x, y, 1], z=-x*x; for(let i=0;i<5;i++){ b[i]+=r[i]*z; for(let j=0;j<5;j++) A[i][j]+=r[i]*r[j]; } }
  const [B,C,D,E,F] = solve(A,b), a=1;
  const den = B*B - 4*a*C, cx = (2*C*D - B*E)/den, cy = (2*a*E - B*D)/den;
  // axes
  const num = 2*(a*E*E + C*D*D - B*D*E + den*F);
  const s = Math.sqrt((a-C)**2 + B*B);
  const r1 = -Math.sqrt(num*(a+C+s))/den, r2 = -Math.sqrt(num*(a+C-s))/den;
  const th = B === 0 ? (a < C ? 0 : Math.PI/2) : Math.atan2(C - a - s, B);
  const res = pts.map(([x,y]) => { // approx radial residual
    const dx=x-cx, dy=y-cy, ang=Math.atan2(dy,dx)-th, rr = 1/Math.sqrt((Math.cos(ang)/r1)**2+(Math.sin(ang)/r2)**2); return Math.hypot(dx,dy)-rr; });
  const rms = Math.sqrt(res.reduce((s,v)=>s+v*v,0)/res.length);
  return { cx, cy, r1, r2, th: th*180/Math.PI, rms, res, coef:[a,B,C,D,E,F] }; }
