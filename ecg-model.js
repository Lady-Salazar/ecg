/* Clasificador de ritmos ECG entrenado (red convolucional 1D) que corre en el navegador.
 *
 * - Los pesos vienen de assets/model/ecg-model-weights.js (generado por
 *   modelo/scripts/05_exportar_js.py).
 * - El preprocesado repite EXACTAMENTE modelo/scripts/ecgprep.py:
 *   ventana de 10 s -> quitar media -> pasa-altos 0.5 Hz y pasa-bajos 40 Hz (ida y vuelta)
 *   -> interpolacion lineal a 120 Hz -> dividir por el percentil 99 de |x| -> recortar a +-4.
 * - La red distingue 18 patrones. Los 27 ritmos de la app y las variantes del ProSim
 *   (gruesa/fina, 160/200 LPM) se deciden despues con la frecuencia y otras medidas.
 *
 * Prototipo educativo: no es un dispositivo medico ni sustituye una evaluacion profesional.
 */
(function attachEcgModel(root){
  const VENTANA_S=10, FS_OUT=120, N_OUT=VENTANA_S*FS_OUT, HP_HZ=0.5, LP_HZ=40, Q=Math.SQRT1_2, PCTL=0.99, CLIP=4;

  // Umbrales de las reglas. Los marcados (*) conviene ajustarlos con el ProSim.
  const config={
    cuentasPorMv:1365,         // firmware ESP32: ADC 12 bits a 3.3 V y ganancia 1100 del AD8232
    confianzaMinima:0.60,     // por debajo se muestra "No concluyente"
    pausaTolerancia:0.12,      // bloqueo de salida si la pausa es multiplo del R-R con este margen
    arritmiaSinusalS:0.12,     // arritmia sinusal si el R-R varia >= 0.12 s (con 60-100 lpm)
    tvCorteLpm:180,            // TV: < 180 -> variante 160 LPM, >= 180 -> 200 LPM
    fvGruesaMv:0.20,           // (*) FV gruesa si la amplitud tipica es >= 0.20 mV
    faGruesaRelacion:0.10,     // (*) FA gruesa si las ondas f miden >= 10 % del QRS
    suavizado:3,               // promedio de las ultimas N evaluaciones
    intervaloS:1               // cada cuantos segundos se reevalua
  };

  // Nombre e id (el id coincide con las fichas de assets/data) de cada patron de la red.
  const NOMBRES={
    sinus:'Ritmo sinusal', pausa_sinusal:'Pausa sinusal', pac:'Ritmo sinusal con extrasístole auricular (PAC)',
    pjc:'Ritmo sinusal con extrasístole de la unión (PJC)', union:'Ritmo de la unión', fa:'Fibrilación auricular',
    flutter:'Flutter auricular', marcapasos_migratorio:'Marcapasos migratorio',
    bav1:'Ritmo sinusal con bloqueo AV de 1.er grado', bav2_tipo1:'Bloqueo AV de 2.º grado tipo I (Wenckebach)',
    bav2_tipo2:'Bloqueo AV de 2.º grado tipo II (Mobitz II)', bav2_2a1:'Bloqueo AV de 2.º grado 2:1',
    bav3:'Bloqueo AV de 3.er grado (completo)', pvc:'Ritmo sinusal con extrasístole ventricular (PVC)',
    ventricular:'Ritmo ventricular', fv:'Fibrilación ventricular',
    marc_auricular:'Ritmo de marcapasos auricular', marc_ventricular:'Ritmo de marcapasos ventricular'
  };
  const IDS={
    sinus:'sinus-rhythm', pac:'nsr-with-pac', pjc:'nsr-with-pjc', fa:'atrial-fibrillation', flutter:'atrial-flutter',
    marcapasos_migratorio:'wandering-pacemaker', bav1:'nsr-with-1-degree-avb', bav2_tipo1:'2-degree-avb-type-i',
    bav2_tipo2:'2-degree-avb-type-ii', bav2_2a1:'2-degree-avb-2-1', bav3:'3-degree-av-block', pvc:'nsr-with-pvc',
    fv:'ventricular-fibrillation', marc_auricular:'paced-atrial', marc_ventricular:'paced-ventricular'
  };

  // ------------------------------------------------------------ pesos
  let red=null;
  function cargar(){
    if(red)return red;
    const W=root.ECG_MODEL_WEIGHTS;
    if(!W)return null;
    const bin=atob(W.b64), bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const datos=new Float32Array(bytes.buffer);
    let p=0;
    const tomar=n=>{const v=datos.subarray(p,p+n);p+=n;return v};
    const capas=W.capas.map(c=>({cin:c.cin,cout:c.cout,k:c.k,pool:c.pool,w:tomar(c.cout*c.cin*c.k),b:tomar(c.cout)}));
    const fc={entradas:W.fc.entradas,salidas:W.fc.salidas,w:tomar(W.fc.salidas*W.fc.entradas),b:tomar(W.fc.salidas)};
    red={clases:W.clases,capas,fc,info:W.info||{}};
    return red;
  }

  // ------------------------------------------------------------ preprocesado
  function biquad(tipo,f0,fs){
    const w0=2*Math.PI*f0/fs, alpha=Math.sin(w0)/(2*Q), c=Math.cos(w0), a0=1+alpha;
    const b=tipo==='lp'?[(1-c)/2,1-c,(1-c)/2]:[(1+c)/2,-(1+c),(1+c)/2];
    return {b0:b[0]/a0,b1:b[1]/a0,b2:b[2]/a0,a1:-2*c/a0,a2:(1-alpha)/a0};
  }
  function filtrarUnaVez(q,x,alReves){
    const n=x.length,y=new Float64Array(n);
    let x1=0,x2=0,y1=0,y2=0;
    for(let k=0;k<n;k++){
      const i=alReves?n-1-k:k, xi=x[i];
      const yi=q.b0*xi+q.b1*x1+q.b2*x2-q.a1*y1-q.a2*y2;
      x2=x1;x1=xi;y2=y1;y1=yi;y[i]=yi;
    }
    return y;
  }
  const idaYVuelta=(q,x)=>filtrarUnaVez(q,filtrarUnaVez(q,x,false),true);

  function filtrar(muestras,fs){
    const n=muestras.length,x=new Float64Array(n);
    let media=0;
    for(let i=0;i<n;i++)media+=muestras[i];
    media/=n;
    for(let i=0;i<n;i++)x[i]=muestras[i]-media;
    return idaYVuelta(biquad('lp',LP_HZ,fs),idaYVuelta(biquad('hp',HP_HZ,fs),x));
  }
  function remuestrear(x,fs){
    const y=new Float64Array(N_OUT),ult=x.length-1;
    for(let i=0;i<N_OUT;i++){
      const pos=Math.min(i*(fs/FS_OUT),ult), i0=Math.floor(pos), i1=Math.min(i0+1,ult), f=pos-i0;
      y[i]=x[i0]*(1-f)+x[i1]*f;
    }
    return y;
  }
  function escala(y){
    const a=Float64Array.from(y,Math.abs).sort();
    return a[Math.floor(PCTL*(a.length-1))];
  }
  /** Ventana cruda de 10 s -> {v: Float32Array normalizado, y: filtrada a 120 Hz, s: escala}. */
  function preprocesar(muestras,fs){
    // v: entrada de la red (recortada a +-4).  u: la misma senal sin recortar, para medir
    // latidos: en bradicardia el recorte igualaba la onda T al QRS y se contaba doble.
    const y=remuestrear(filtrar(muestras,fs),fs), s=escala(y), v=new Float32Array(N_OUT), u=new Float32Array(N_OUT);
    if(s>=1e-9)for(let i=0;i<N_OUT;i++){u[i]=y[i]/s;v[i]=Math.max(-CLIP,Math.min(CLIP,u[i]))}
    return {v,u,y,s};
  }

  // ------------------------------------------------------------ red neuronal
  function inferir(v){
    const m=cargar();
    let x=v, L=v.length;
    for(const c of m.capas){
      const pad=c.k>>1, out=new Float32Array(c.cout*L);
      for(let co=0;co<c.cout;co++){
        const base=co*L, sesgo=c.b[co];
        for(let t=0;t<L;t++)out[base+t]=sesgo;
        for(let ci=0;ci<c.cin;ci++){
          const xin=ci*L, wb=(co*c.cin+ci)*c.k;
          for(let j=0;j<c.k;j++){
            const w=c.w[wb+j], d=j-pad, t0=Math.max(0,-d), t1=Math.min(L,L-d);
            for(let t=t0;t<t1;t++)out[base+t]+=w*x[xin+t+d];
          }
        }
      }
      for(let i=0;i<out.length;i++)if(out[i]<0)out[i]=0;
      if(c.pool){
        const L2=L>>1, p=new Float32Array(c.cout*L2);
        for(let co=0;co<c.cout;co++)for(let t=0;t<L2;t++){
          const a=out[co*L+2*t], b=out[co*L+2*t+1];
          p[co*L2+t]=a>b?a:b;
        }
        x=p;L=L2;
      }else x=out;
    }
    const C=m.capas[m.capas.length-1].cout, rasgos=new Float32Array(2*C);
    for(let co=0;co<C;co++){
      let suma=0,max=-Infinity;
      for(let t=0;t<L;t++){const val=x[co*L+t];suma+=val;if(val>max)max=val}
      rasgos[co]=suma/L;rasgos[C+co]=max;
    }
    const logits=new Float64Array(m.fc.salidas);
    for(let o=0;o<m.fc.salidas;o++){
      let acc=m.fc.b[o];
      for(let i=0;i<m.fc.entradas;i++)acc+=m.fc.w[o*m.fc.entradas+i]*rasgos[i];
      logits[o]=acc;
    }
    const mx=Math.max(...logits), e=Array.from(logits,z=>Math.exp(z-mx)), tot=e.reduce((a,b)=>a+b,0);
    return e.map(z=>z/tot);
  }

  // ------------------------------------------------------------ medidas para las reglas
  function picosR(v){
    let mx=-Infinity,mn=Infinity;
    for(const a of v){if(a>mx)mx=a;if(a<mn)mn=a}
    const signo=mx>=-mn?1:-1, tope=Math.max(mx,-mn), umbral=0.5*tope, refractario=Math.round(0.18*FS_OUT), picos=[];
    for(let i=1;i<v.length-1;i++){
      const a=signo*v[i];
      if(a>=umbral&&a>signo*v[i-1]&&a>=signo*v[i+1]){
        if(picos.length&&i-picos[picos.length-1]<refractario){
          if(a>signo*v[picos[picos.length-1]])picos[picos.length-1]=i;
        }else picos.push(i);
      }
    }
    return {picos,amplitud:tope};
  }
  const mediana=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[s.length>>1]};
  function lpmPorPicos(picos){
    if(picos.length<3)return null;
    const rr=[];
    for(let i=1;i<picos.length;i++)rr.push((picos[i]-picos[i-1])/FS_OUT);
    return Math.round(60/mediana(rr));
  }
  /** Frecuencia de un ritmo casi periodico (TV) por autocorrelacion: 100-250 lpm. */
  function lpmPorAutocorrelacion(v){
    const n=v.length, lagMin=Math.round(0.24*FS_OUT), lagMax=Math.round(0.60*FS_OUT), r=[];
    let e=0;
    for(let i=0;i<n;i++)e+=v[i]*v[i];
    if(e<=0)return null;
    let mejor=-Infinity;
    for(let lag=lagMin-1;lag<=lagMax+1;lag++){
      let acc=0;
      for(let i=0;i+lag<n;i++)acc+=v[i]*v[i+lag];
      r[lag]=acc/e*n/(n-lag);
      if(lag>=lagMin&&lag<=lagMax&&r[lag]>mejor)mejor=r[lag];
    }
    if(mejor<0.3)return null;
    // primer maximo local cercano al mejor: evita quedarse con el doble del periodo
    for(let lag=lagMin;lag<=lagMax;lag++){
      if(r[lag]>=0.9*mejor&&r[lag]>=r[lag-1]&&r[lag]>=r[lag+1]){
        const den=r[lag-1]-2*r[lag]+r[lag+1], delta=den?0.5*(r[lag-1]-r[lag+1])/den:0;
        return Math.round(60*FS_OUT/(lag+delta));
      }
    }
    return null;
  }
  /** Tamano de las ondas f (pico a pico) relativo al QRS, medido entre latidos. */
  function relacionOndasF(v,picos,amplitud){
    const ini=Math.round(0.40*FS_OUT), fin=Math.round(0.10*FS_OUT), minimo=Math.round(0.12*FS_OUT), medio=Math.round(0.125*FS_OUT), desv=[];
    for(let k=0;k+1<picos.length;k++){
      const a=picos[k]+ini, b=picos[k+1]-fin;
      if(b-a<minimo)continue;
      let suma=0,suma2=0,m=0;
      for(let i=a;i<b;i++){
        // quita la tendencia lenta (cola de la onda T) con una media movil de 0.25 s
        let loc=0,cnt=0;
        for(let j=Math.max(a,i-medio);j<Math.min(b,i+medio+1);j++){loc+=v[j];cnt++}
        const d=v[i]-loc/cnt;
        suma+=d;suma2+=d*d;m++;
      }
      desv.push(Math.sqrt(Math.max(0,suma2/m-(suma/m)**2)));
    }
    if(desv.length<2||!amplitud)return null;
    return 2.83*mediana(desv)/amplitud;
  }

  // ------------------------------------------------------------ clasificacion
  /**
   * @param muestras ultimos 10 s de senal cruda (Array o TypedArray), a fs Hz
   * @param fs       frecuencia de muestreo en Hz
   * @param opciones {unidadesPorMv} cuantas unidades de la senal equivalen a 1 mV en el electrodo
   */
  function clasificar(muestras,fs,opciones={}){
    const m=cargar();
    if(!m)return {ok:false,motivo:'modelo no cargado'};
    const n=Math.round(VENTANA_S*fs);
    if(!fs||muestras.length<n)return {ok:false,motivo:'faltan datos'};
    const ventana=muestras.length>n?muestras.slice(muestras.length-n):muestras;
    const {v,u,s}=preprocesar(ventana,fs);
    if(s<1e-9)return {ok:false,motivo:'señal plana'};
    return {ok:true,probs:inferir(v),v,u,s,unidadesPorMv:opciones.unidadesPorMv||null};
  }

  /** Convierte probabilidades + senal en el texto final con variante y medidas. */
  function intervalosRR(picos){
    const rr=[];
    for(let i=1;i<picos.length;i++)rr.push((picos[i]-picos[i-1])/FS_OUT);
    return rr;
  }
  /** Convierte probabilidades + senal en el ritmo final (uno de los 27) con variante y medidas. */
  function interpretar(probs,vRed,s,unidadesPorMv,u){
    const m=cargar(), v=u||vRed;
    let k=0;
    for(let i=1;i<probs.length;i++)if(probs[i]>probs[k])k=i;
    const clase=m.clases[k], confianza=probs[k];
    const r={clase,id:IDS[clase]||null,confianza,probs:Object.fromEntries(m.clases.map((c,i)=>[c,probs[i]])),nombre:NOMBRES[clase]||clase,variante:null,lpm:null,concluyente:confianza>=config.confianzaMinima,notas:[]};
    const fijar=(nombre,id)=>{r.nombre=nombre;r.id=id};
    const {picos,amplitud}=picosR(v), rr=intervalosRR(picos);
    if(clase!=='fv')r.lpm=lpmPorPicos(picos);

    if(clase==='sinus'&&r.lpm){
      // mismos rangos que las fichas de la app: < 60 bradicardia, 101-150 taquicardia
      if(r.lpm<60)fijar('Bradicardia sinusal','sinus-bradycardia');
      else if(r.lpm>150)fijar('Taquicardia supraventricular (TSV)','svt'); // estrecha y regular > 150: TSV segun las fichas (incluye la taquicardia auricular)
      else if(r.lpm>100)fijar('Taquicardia sinusal','sinus-tachycardia');
      else if(rr.length>=5&&Math.max(...rr)-Math.min(...rr)>=config.arritmiaSinusalS)fijar('Arritmia sinusal','sinus-arrhythmia');
    }else if(clase==='pausa_sinusal'){
      // pausa = multiplo exacto del R-R de base -> bloqueo de salida; si no -> paro sinusal
      const base=mediana(rr), larga=rr.length?Math.max(...rr):null;
      if(base&&larga&&larga/base>=1.5){
        const razon=larga/base, cerca=Math.abs(razon-Math.round(razon))<=config.pausaTolerancia&&Math.round(razon)>=2;
        r.pausaS=larga;r.razonPausa=razon;
        if(cerca)fijar('Bloqueo de salida sinusal','sinus-exit-block');else fijar('Paro sinusal','sinus-arrest');
        r.variante=`pausa de ${larga.toFixed(1)} s`;
      }else r.notas.push('No se pudo medir la pausa para distinguir bloqueo de salida de paro sinusal.');
    }else if(clase==='union'&&r.lpm){
      if(r.lpm<=60)fijar('Ritmo de la unión','junctional-rhythm');
      else if(r.lpm<=100)fijar('Ritmo de la unión acelerado','accelerated-junctional-rhythm');
      else if(r.lpm<150)fijar('Taquicardia de la unión','junctional-tachycardia');
      else fijar('Taquicardia supraventricular (TSV)','svt');
    }else if(clase==='ventricular'){
      const rapida=lpmPorAutocorrelacion(v);
      if(!(r.lpm&&r.lpm<=100)&&rapida)r.lpm=rapida;
      if(r.lpm){
        if(r.lpm<=40)fijar('Ritmo idioventricular','idioventricular-rhythm');
        else if(r.lpm<=100)fijar('Ritmo idioventricular acelerado','accelerated-idioventricular-rhythm');
        else{fijar('Taquicardia ventricular','ventricular-tachycardia');r.variante=r.lpm>=config.tvCorteLpm?'200 LPM':'160 LPM'}
      }
    }else if(clase==='fv'){
      if(unidadesPorMv){
        const mv=s/unidadesPorMv;
        r.amplitudMv=mv;
        r.variante=mv>=config.fvGruesaMv?'gruesa':'fina';
      }else r.notas.push('Sin escala en mV no se puede distinguir gruesa de fina.');
    }else if(clase==='fa'){
      const rel=relacionOndasF(v,picos,amplitud);
      if(rel!==null){r.relacionOndasF=rel;r.variante=rel>=config.faGruesaRelacion?'gruesa':'fina'}
    }
    r.titulo=r.variante?`${r.nombre} · ${r.variante}`:r.nombre;
    return r;
  }

  // ------------------------------------------------------------ uso en vivo
  let buffer=[], fsActual=null, desdeUltima=0, historial=[], ultimo=null, alCambiar=null, unidades=null;
  function reiniciar(){buffer=[];desdeUltima=0;historial=[];ultimo=null}
  /** Recibe muestras nuevas; reevalua cada config.intervaloS segundos cuando hay 10 s. */
  function alimentar(valores,fs,opciones={}){
    if(!fs||!valores.length)return;
    if(fs!==fsActual){reiniciar();fsActual=fs}
    if(opciones.unidadesPorMv!==undefined)unidades=opciones.unidadesPorMv;
    const n=Math.round(VENTANA_S*fs);
    for(const x of valores)buffer.push(x);
    if(buffer.length>n)buffer.splice(0,buffer.length-n);
    desdeUltima+=valores.length;
    if(buffer.length<n||desdeUltima<config.intervaloS*fs)return;
    desdeUltima=0;
    const c=clasificar(buffer,fs);
    if(!c.ok){ultimo={ok:false,motivo:c.motivo};if(alCambiar)alCambiar(ultimo);return}
    historial.push(c.probs);
    if(historial.length>config.suavizado)historial.shift();
    const prom=c.probs.map((_,i)=>historial.reduce((a,p)=>a+p[i],0)/historial.length);
    ultimo={ok:true,...interpretar(prom,c.v,c.s,unidades,c.u)};
    if(alCambiar)alCambiar(ultimo);
  }
  /** Segundos que faltan para la primera lectura (0 si ya hay ventana completa). */
  function faltanSegundos(){return fsActual?Math.max(0,VENTANA_S-buffer.length/fsActual):VENTANA_S}

  root.EcgModel={
    config,NOMBRES,VENTANA_S,FS_OUT,N_OUT,
    disponible:()=>!!cargar(), info:()=>cargar()?.info||null, clases:()=>cargar()?.clases||[],
    preprocesar,inferir,clasificar,interpretar,
    alimentar,reiniciar,faltanSegundos,
    get ultimo(){return ultimo},
    set alCambiar(fn){alCambiar=fn}
  };
})(globalThis);
