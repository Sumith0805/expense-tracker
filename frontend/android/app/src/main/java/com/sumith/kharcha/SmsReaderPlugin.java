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
 * Reads payment alerts from the SMS inbox and hands them to the app, which reads them on the phone.
 * A message is passed on only if it comes from a sender name (a bank), not a phone number, and it
 * mentions a money word and an amount. Chats and most promotions never leave this function.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = { @Permission(strings = { Manifest.permission.READ_SMS }, alias = "sms") }
)
public class SmsReaderPlugin extends Plugin {

    private static final Pattern MONEY_WORDS = Pattern.compile(
        "(?i)(\\bdebited\\b|\\bcredited\\b|\\bwithdrawn\\b|\\bspent\\b|\\bpaid\\b|\\bsent\\b|\\breceived\\b"
        + "|\\bdeposited\\b|\\bpurchase\\b|\\btransferred\\b|\\bdr\\b|\\bcr\\b|\\brefund)");
    private static final Pattern AMOUNT = Pattern.compile("(?i)(rs\\.?\\s*\\d|inr\\s*\\d|\u20B9\\s*\\d|\\d+\\.\\d{2})");
    private static final Pattern PHONE_NUMBER = Pattern.compile("^\\+?\\d[\\d\\s-]{6,}$");
    private static final int MAX_BODY = 600;

    @PluginMethod
    public void readMessages(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission was not granted");
            return;
        }
        int days = call.getInt("days", 90);
        int limit = call.getInt("limit", 3000);
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
                    String sender = c.getString(0);
                    String body = c.getString(1);
                    if (body == null) continue;
                    if (sender != null && PHONE_NUMBER.matcher(sender.trim()).matches()) continue;
                    if (!MONEY_WORDS.matcher(body).find() || !AMOUNT.matcher(body).find()) continue;
                    JSObject m = new JSObject();
                    m.put("sender", sender);
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