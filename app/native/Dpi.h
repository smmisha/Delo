#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shellscalingapi.h>
#pragma comment(lib,"Shcore.lib")

namespace delo {
// The scale of the monitor a window is on. Windows does not always update a window's own DPI
// (GetDpiForWindow) when the display scale changes: on the user's laptop neither the widget nor
// the harness learned of 150 % -> 200 % -> 100 %, while the monitor reported each new scale at
// once. Sizes, hit areas and the glass geometry therefore follow the monitor.
inline UINT MonitorDpi(HMONITOR monitor){UINT x=0,y=0;return SUCCEEDED(GetDpiForMonitor(monitor,MDT_EFFECTIVE_DPI,&x,&y))&&x?x:USER_DEFAULT_SCREEN_DPI;}
inline UINT MonitorDpi(HWND hwnd){return MonitorDpi(MonitorFromWindow(hwnd,MONITOR_DEFAULTTONEAREST));}
inline UINT PointDpi(POINT point){return MonitorDpi(MonitorFromPoint(point,MONITOR_DEFAULTTONEAREST));}
}
