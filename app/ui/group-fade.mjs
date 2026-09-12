// Mask only the rows: the original sticky heading stays sharp and interactive.
export function installGroupFade(scroll){
 let rows=[],frame=0;
 function paint(){
  frame=0;
  const top=scroll.getBoundingClientRect().top;
  const changes=rows.map(row=>{
   const heading=row.previousElementSibling.getBoundingClientRect();
   const pinned=scroll.scrollTop>0&&heading.top<=top+.5;
   return [row,pinned?Math.max(-14,heading.bottom-row.getBoundingClientRect().top):-14];
  });
  for(const [row,offset] of changes)row.style.setProperty('--group-fade-start',`${offset}px`);
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
 const resize=new ResizeObserver(schedule);
 scroll.addEventListener('scroll',schedule,{passive:true});
 return function refresh(){
  rows=[...scroll.querySelectorAll('.task-group-rows')];
  resize.disconnect();resize.observe(scroll);
  for(const row of rows)resize.observe(row);
  schedule();
 };
}
