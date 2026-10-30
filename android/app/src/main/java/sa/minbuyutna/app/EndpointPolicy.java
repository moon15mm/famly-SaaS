package sa.minbuyutna.app;

import java.net.URI;
import java.util.Locale;

/** An explicit platform origin; never infer trust from a URL prefix. */
final class EndpointPolicy {
    private EndpointPolicy() { }

    static String normalize(String value, boolean debug) {
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            String path = uri.getRawPath();
            if (host.isEmpty() || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null || (path != null && !path.isEmpty() && !path.equals("/"))
                    || uri.getPort() > 65535 || uri.getPort() == 0) throw new IllegalArgumentException();
            boolean local = host.equals("localhost") || host.equals("127.0.0.1");
            if (!scheme.equals("https") && !(debug && scheme.equals("http") && local)) {
                throw new IllegalArgumentException();
            }
            int port = uri.getPort();
            if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
            return new URI(scheme, null, host, port, null, null, null).toASCIIString();
        } catch (Exception error) {
            throw new IllegalArgumentException("أدخل رابط HTTPS للمنصة، أو localhost للنسخة المحلية فقط");
        }
    }

    static boolean sameOrigin(String base, String value) {
        try {
            URI uri = new URI(value);
            if (uri.getRawUserInfo() != null) return false;
            String origin = new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString();
            return normalize(origin, true).equals(normalize(base, true));
        } catch (Exception error) { return false; }
    }

    static boolean externalAllowed(String value) {
        try {
            String scheme = new URI(value).getScheme();
            return "https".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme)
                    || "mailto".equalsIgnoreCase(scheme) || "geo".equalsIgnoreCase(scheme);
        } catch (Exception error) { return false; }
    }
}
