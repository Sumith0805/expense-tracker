package com.sumith.kharcha;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.regex.Pattern;

/**
 * Reads bank payment alerts from the SMS inbox.
 * Only messages that mention a debit or credit AND an account or UPI are returned,
 * so chats, OTPs and promotions never leave the phone.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = { @Permission(strings = { Manifest.permission.READ_SMS }, alias = "sms") }
)
public class SmsReaderPlugin extends Plugin {

    private static final Pattern MONEY_WORDS = Pattern.compile("(?i)(\\bdebited\\b|\\bcredited\\b|\\bdr\\.)");
    private static final Pattern BANK_WORDS = Pattern.compile("(?i)(UPI|A/C|Acct)");
    private static final int MAX_BODY = 600;

    @PluginMethod
    public void readMessages(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission was not granted");
            return;
        }
        int days = call.getInt("days", 90);
        int limit = call.getInt("limit", 1500);
        long since = System.currentTimeMillis() - days * 86400000L;

        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(
                Uri.parse("content://sms/inbox"),
                new String[] { "address", "body", "date" },
                "date >= ?",
                new String[] { String.valueOf(since) },
                "date DESC")) {
            if (c != null) {
                while (c.moveToNext() && out.length() < limit) {
                    String body = c.getString(1);
                    if (body == null) continue;
                    if (!MONEY_WORDS.matcher(body).find() || !BANK_WORDS.matcher(body).find()) continue;
                    JSObject m = new JSObject();
                    m.put("sender", c.getString(0));
                    m.put("body", body.length() > MAX_BODY ? body.substring(0, MAX_BODY) : body);
                    m.put("date", c.getLong(2));
                    out.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read messages: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("messages", out);
        call.resolve(ret);
    }
}