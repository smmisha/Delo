#include "../native/ScreenshotKeys.h"
#include <cassert>
#include <iostream>
int main(){
    delo::ScreenshotChord keys;
    assert(!keys.Update('S',true));keys.Update('S',false);
    assert(!keys.Update(VK_LWIN,true));assert(!keys.Update('S',true));keys.Update('S',false);
    assert(!keys.Update(VK_LSHIFT,true));assert(keys.Update('S',true));
    assert(!keys.Update('S',true));assert(!keys.Update('S',false));assert(keys.Update('S',true));keys.Update('S',false);
    keys.Update(VK_LCONTROL,true);assert(!keys.Update('S',true));keys.Update('S',false);keys.Update(VK_LCONTROL,false);
    keys.Update(VK_LMENU,true);assert(!keys.Update('S',true));keys.Update('S',false);keys.Update(VK_LMENU,false);
    keys.Update(VK_LWIN,false);keys.Update(VK_LSHIFT,false);
    keys.Update(VK_RWIN,true);keys.Update(VK_RSHIFT,true);assert(keys.Update('S',true));keys.Update('S',false);
    keys.Update(VK_RWIN,false);keys.Update(VK_RSHIFT,false);
    assert(keys.Update(VK_SNAPSHOT,true));assert(!keys.Update(VK_SNAPSHOT,true));keys.Update(VK_SNAPSHOT,false);assert(keys.Update(VK_SNAPSHOT,true));
    assert(!keys.Update('A',true));assert(!keys.down['A']);
    delo::ScreenshotChord lightshot;
    assert(!lightshot.Update(VK_INSERT,true));assert(!lightshot.down[VK_INSERT]);
    assert(lightshot.Update(VK_INSERT,true,VK_INSERT));
    assert(!lightshot.Update(VK_INSERT,true,VK_INSERT));lightshot.Update(VK_INSERT,false,VK_INSERT);
    lightshot.Update(VK_LCONTROL,true,VK_INSERT);
    assert(!lightshot.Update(VK_INSERT,true,VK_INSERT));lightshot.Update(VK_INSERT,false,VK_INSERT);
    const DWORD ctrlInsert=VK_INSERT|(MOD_CONTROL<<8);
    assert(lightshot.Update(VK_INSERT,true,ctrlInsert));
    assert(!lightshot.Update(VK_INSERT,true));assert(!lightshot.down[VK_INSERT]);
    assert(lightshot.Update(VK_SNAPSHOT,true,VK_INSERT));
    static_assert(delo::ScreenshotKeys::PrepareTimeoutMs==100);
    static_assert(delo::ScreenshotKeys::MousePrepareTimeoutMs==250);
    std::cout<<"PASS: screenshot chords, both modifier sides, no repeats, configured Lightshot key/modifiers, disabled key not retained\n";
}
