export function Emblem({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 76" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 12v49m-5 2h10M29 67h6"/><circle cx="32" cy="8" r="3"/>
      <path d="M31 19C21 8 10 11 5 7c2 12 13 20 25 19M33 19C43 8 54 11 59 7c-2 12-13 20-25 19" fill="currentColor" strokeWidth=".6"/>
      <path d="M14 14l9 5m-4-5 8 6m23-6-9 5m4-5-8 6" stroke="white" strokeWidth="1"/>
      <path d="M24 27c-10 4-5 12 8 16s14 11 2 14M40 27c10 4 5 12-8 16s-14 11-2 14M24 27l3 1m13-1-3 1"/>
      <path d="M27 70C9 65 4 48 9 31M37 70c18-5 23-22 18-39"/>
      <path d="M9 40C3 35 4 30 5 27c5 3 6 7 4 13m-2 9c-7-4-7-9-6-12 6 2 8 6 6 12m3 10C3 58 1 52 2 49c6 0 10 4 8 10m7 8C9 69 6 65 5 61c6-2 11 1 12 6m38-27c6-5 5-10 4-13-5 3-6 7-4 13m2 9c7-4 7-9 6-12-6 2-8 6-6 12m-3 10c7-1 9-7 8-10-6 0-10 4-8 10m-7 8c8 2 11-2 12-6-6-2-11 1-12 6" fill="currentColor" strokeWidth=".4"/>
    </g>
  </svg>;
}
export function Architecture() {
  return <svg className="architecture" viewBox="0 0 530 340" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="arch-fill" x1="320" y1="65" x2="260" y2="325" gradientUnits="userSpaceOnUse"><stop stopColor="#f9fbff"/><stop offset="1" stopColor="#e4edfa"/></linearGradient>
      <linearGradient id="arch-roof" x1="200" y1="90" x2="200" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#b9ceef" stopOpacity=".3"/><stop offset="1" stopColor="#dbe7f8" stopOpacity=".6"/></linearGradient>
    </defs>
    <circle cx="319" cy="162" r="144" fill="#dce8f9" fillOpacity=".6"/>
    <circle cx="319" cy="162" r="167" stroke="#cadaf0" strokeOpacity=".6"/>
    <circle cx="319" cy="162" r="190" stroke="#d6e2f3" strokeDasharray="3 6"/>
    <path d="M104 276h391M89 286h421M63 296h447" stroke="#bdcfea" strokeWidth="1.2"/>
    <g stroke="#6588bc" strokeWidth="1.05" strokeLinejoin="round">
      <path d="M133 273V164l154-46 105 74v81H133Z" fill="url(#arch-fill)"/>
      <path d="m121 166 48-64 122-25 111 115-109-31-160 22-12-17Z" fill="url(#arch-roof)"/>
      <path d="m133 183 160-22 99 31M169 102l124 59M177 101l116 51m-103-54 103 45m-90-48 90 40m-77-43 77 35m-64-38 64 29m-51-32 51 24m-38-27 38 19m-25-22 25 14" strokeOpacity=".55"/>
      <path d="m143 156 26-43 108-23m-134 75 144-24m-150 33 150-24" strokeOpacity=".45"/>
      <path d="M286 274V157l18-11V90l24-6 25 11v51l16 11v117h-83Z" fill="#f3f7fe"/>
      <path d="M303 91 327 32l27 63-26-11-25 7Z" fill="url(#arch-roof)"/>
      <path d="M327 32v52m0-52V20m-5 8h10M300 96l28-7 29 11m-54 1 25-7 26 11M306 142l22-6 23 9m-50 5 27-8 28 11m-70 4 42-12 41 12M286 164l42-12 41 12m-80 57h76M286 228h83M328 94v178"/>
      <path d="M286 169h-9v105h9m83-105h9v105h-9M279 168l4-9 5 9m79 0 6-9 5 9" fill="#edf3fc"/>
      <ellipse cx="314" cy="181" rx="8.5" ry="10.5" fill="#e2ebf9"/><path d="M314 173v9l5 2" strokeWidth="1.5"/>
      <ellipse cx="345" cy="181" rx="8.5" ry="10.5" fill="#e2ebf9"/><path d="M345 173v9l5 2" strokeWidth="1.5"/>
      <path d="M302 218v-17q10-14 19 0v17h-19Zm34 0v-17q10-14 19 0v17h-19Z" fill="#d3e1f5"/>
      <path d="M311 191v27m34-27v27M307 274v-30q6-15 14 0v30m15 0v-30q7-15 14 0v30" fill="#ccdcf2"/>
      <path d="M310 132v-20q5-10 11 0v19m16 0v-19q5-10 11 0v21" fill="#dbe6f7"/>
      {[150, 176, 202, 228, 254].map((x, i) => <g key={x} transform={`translate(${x} ${192-i*3})`}><path d="M0 50V10Q7-6 14 10v40H0Z" fill="#d7e4f6"/><path d="M7 0v50M0 17h14M0 34h14M-3 54h20"/></g>)}
      <path d="M137 250h139m-139 9h139m-122-77v88m-27-80v80m54-93v93m27-97v97m26-100v100m26-104v104" strokeOpacity=".5"/>
      <path d="M378 205v43m0-32 22 6v31m-22-21 22 6m-22 13 21 5M392 196l60 23v53h-60" fill="url(#arch-fill)"/>
      <path d="m392 195 16-23 55 43-11 4-60-24Z" fill="url(#arch-roof)"/>
      <path d="M412 234v21m13-17v20m13-15v18M405 269h42" strokeWidth="2.3" strokeOpacity=".5"/>
      <path d="M117 274v-31q-15-2-16-15-15-9-7-22-5-15 10-20 5-20 21-9 18-3 21 11 15 9 3 23 5 15-10 20-2 13-14 12v31" fill="#e9f1fc" stroke="#9bb4d8"/>
      <path d="M121 273v-67m0 28-13-11m13-1 14-17m-14 40 13-9" stroke="#9bb4d8"/>
      <path d="M467 274v-38q-13-2-14-12-13-8-6-19-4-13 9-18 5-16 18-7 15-3 18 9 13 7 2 20 5 12-8 17-2 10-12 10v38" fill="#e9f1fc" stroke="#9bb4d8"/><path d="M472 273v-61m0 22-11-10m11 0 11-13" stroke="#9bb4d8"/>
    </g>
    <g stroke="#96b0d5" strokeWidth="1.2"><path d="M402 78q6-7 13 0 6-7 13 0M165 54q5-6 10 0 5-6 10 0M443 118q4-5 8 0 4-5 8 0"/><path d="M180 308h48m10 0h19m78 0h52m8 0h15M242 317h63m9 0h18" strokeOpacity=".6"/></g>
    <circle cx="442" cy="63" r="4" fill="#8aabd8" fillOpacity=".45"/><circle cx="150" cy="102" r="3" fill="#8aabd8" fillOpacity=".4"/>
  </svg>;
}
