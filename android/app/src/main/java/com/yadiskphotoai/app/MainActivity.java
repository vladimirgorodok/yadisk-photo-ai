package com.yadiskphotoai.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public MainActivity() {
        registerPlugin(StorageAccessPlugin.class);
    }
}
