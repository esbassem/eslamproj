import { AppNavigation } from './AppNavigation';

export function AppSidebar(props) {
  return (
    <aside className="hidden h-full min-h-0 w-[22rem] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-7 lg:block xl:w-[24rem]">
      <AppNavigation {...props} />
    </aside>
  );
}
