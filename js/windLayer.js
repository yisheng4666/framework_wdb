//---------------------------------------------------------------------------
//  File: WindLayer.js
//  Change: 杨国强，创建于2016-08-17
//
//---------------------------------------------------------------------------

function WindLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var uv = layer.data;
	for (let i in uv.TimeData)
		uv.TimeData[i] = Date.parse(uv.TimeData[i]);

	var previewCanvas, mainCanvas;
	var previewCtx, mainCtx;
	var drawMain = null; // 绘制主画布
	var drawPreview = null; // 绘制预览画布
	
	// glsl程序
	var vertexShaderStr = `
  			precision lowp float;
  			const float PI = 3.1415926536;
  			const float RADIAN_HALF = 3.1415926536/360.0;
  			const float RADIAN_REVERSE = 180.0/3.1415926536;
  			vec2 mercatorProjectViewport(
  			  vec3 lnglat,
  			  vec3 mapParam,
  			  vec2 viewport
  			) {
  				float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
          return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
              (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
  			}
  
  			attribute vec3 scatterData; 
  			uniform vec4 latlonRange;
  			uniform vec3 mapParam; 
  			uniform vec2 viewPort;
  			uniform vec4 uColor;
  
  			varying vec3 finalColor;
  		  const vec3 startColor = vec3(0.6,0.0,0.0);
  		  const vec3 midColor1 = vec3(1.0,0.1,0.0);
  		  const vec3 midColor2 = vec3(0.9,1.0,0.1);
  		  const vec3 midColor3 = vec3(0.1,0.7,1.0);
  		  const vec3 endColor = vec3(1.0,1.0,1.0);
  			void main(void)
  			{
  			  gl_Position = vec4(mercatorProjectViewport(scatterData, mapParam, viewPort), 0.0, 1.0);
  		    float ratio = scatterData[2];
  		    if (ratio>0.75) {
  		    	finalColor = midColor1 + (startColor-midColor1)*(ratio-0.75)*4.0;
  		    } else if (ratio>0.5) {
  		    	finalColor = midColor2+(midColor1-midColor2)*(ratio-0.5)*4.0;
  		    } else if (ratio>0.25) {
  		    	finalColor = midColor3+(midColor2-midColor3)*(ratio-0.25)*4.0;
  		    } else {
  		    	finalColor = endColor+(midColor3-endColor)*(ratio)*4.0;
  		    }
  			}
  `;

  var fragmentShaderStr = `
        precision mediump float;
  			varying vec3 finalColor;
				uniform float layerOpacity;
  
  			void main(void)
  			{
          gl_FragColor = vec4(finalColor, layerOpacity);
  			}
  `;
    
  var previewVertextShaderStr = `
			attribute float posLat;
			attribute float posLon;
			attribute float density;
			uniform vec2 dataRange;
			uniform vec4 latlonRange;
			uniform vec3 startColor;
			uniform vec3 midColor1;
			uniform vec3 midColor2;
			uniform vec3 midColor3;
			uniform vec3 endColor;
			varying vec3 finalColor;
			void main(void)
			{
			    float ratio = (density-dataRange.x)/(dataRange.y-dataRange.x);
			    if (ratio>0.75) {
			    	finalColor = midColor1 + (startColor-midColor1)*(ratio-0.75)*4.0;
			    } else if (ratio>0.5) {
			    	finalColor = midColor2+(midColor1-midColor2)*(ratio-0.5)*4.0;
			    } else if (ratio>0.25) {
			    	finalColor = midColor3+(midColor2-midColor3)*(ratio-0.25)*4.0;
			    } else {
			    	finalColor = endColor+(midColor3-endColor)*(ratio)*4.0;
			    }
			    
			    gl_Position = vec4((posLon-latlonRange[0])/latlonRange[1],(posLat-latlonRange[2])/latlonRange[3], 0.0, 1.0);
			}`;
	var previewFragmentShaderStr = `
      precision mediump float;
			varying vec3 finalColor;

			void main(void)
			{
        gl_FragColor = vec4(finalColor, 1.0);
			}`;
				
	function getDrawMaskRectFunc(gl) {
	  var fragmentShaderSource = `
	    precision highp float;
	    void main() {
	     gl_FragColor = vec4(0.0,0.0,0.0,0.95);
	    }
	  `;
	
	  var vertexShaderSource = `
	    attribute vec2 a_position;
	    void main() {
	      gl_Position = vec4(a_position, 0, 1);
	    }
	  `;
	
	  var program = gl.createProgram();
	
	  var vertexShader = gl.createShader(gl.VERTEX_SHADER);
	  gl.shaderSource(vertexShader, vertexShaderSource);
	  gl.compileShader(vertexShader);
	  gl.attachShader(program, vertexShader);
	
	  var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
	  gl.shaderSource(fragmentShader, fragmentShaderSource);
	  gl.compileShader(fragmentShader);
	  gl.attachShader(program, fragmentShader);
	
	  gl.linkProgram(program);
	  gl.useProgram(program);
	
		var positionLocation = gl.getAttribLocation(program, 'a_position');
	  var buffer = gl.createBuffer();
	  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
	    -1,-1, -1,1, 1,-1,
	    -1,1, 1,-1, 1,1,
	  ]), gl.STATIC_DRAW);
	
		return function(){
		  gl.useProgram(program);
	
	   // gl.blendFuncSeparate( gl.SRC_ALPHA, gl.SRC_ALPHA, gl.SRC_ALPHA, gl.ZERO );
	    gl.blendFunc( gl.ZERO, gl.SRC_ALPHA );
		
	    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		  gl.enableVertexAttribArray(positionLocation);
		  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
		  gl.drawArrays(gl.TRIANGLES, 0, 6);
		  
		  gl.blendFuncSeparate( gl.SRC_ALPHA, gl.SRC_ALPHA, gl.ZERO, gl.ZERO );
		}
	}
	
	// 折线插值为曲线
	var _smoothSpline = function() {
	    function vectordistance(v1, v2) {
	            return Math.sqrt((v1[0] - v2[0]) * (v1[0] - v2[0]) + (v1[1] - v2[1]) * (v1[1] - v2[1]));
	    }
	    function interpolate(p0, p1, p2, p3, t, t2, t3) {
	        var v0 = (p2 - p0) * 0.5;
	        var v1 = (p3 - p1) * 0.5;
	        return (2 * (p1 - p2) + v0 + v1) * t3 + (-3 * (p1 - p2) - 2 * v0 - v1) * t2 + v0 * t + p1;
	    }
	    return function (points, isLoop) {
	        var len = points.length;
	        var ret = [];
	        var distance = 0;
	        for (var i = 1; i < len; i++) {
	            distance += vectordistance(points[i - 1], points[i]);
	        }
	        var segs = distance / 5;
	        segs = segs < len ? len : segs;
	        for (var i = 0; i < segs; i++) {
	            var pos = i / (segs - 1) * (isLoop ? len : len - 1);
	            var idx = Math.floor(pos);
	            var w = pos - idx;
	            var p0;
	            var p1 = points[idx % len];
	            var p2;
	            var p3;
	            if (!isLoop) {
	                p0 = points[idx === 0 ? idx : idx - 1];
	                p2 = points[idx > len - 2 ? len - 1 : idx + 1];
	                p3 = points[idx > len - 3 ? len - 1 : idx + 2];
	            } else {
	                p0 = points[(idx - 1 + len) % len];
	                p2 = points[(idx + 1) % len];
	                p3 = points[(idx + 2) % len];
	            }
	            var w2 = w * w;
	            var w3 = w * w2;
	            let res = [
	                interpolate(p0[0], p1[0], p2[0], p3[0], w, w2, w3),
	                interpolate(p0[1], p1[1], p2[1], p3[1], w, w2, w3),
	                interpolate(p0[2], p1[2], p2[2], p3[2], w, w2, w3),
	            ];
	            if (ret.length<1)
	            	res[3] = 0;
	            else
	            	res[3] = vectordistance(res, ret[ret.length-1]);
	            ret.push(res);
	        }
	        return ret;
	    };
	};
	var smoothSpline = new _smoothSpline();
	
	// 360度分为12个方向，根据当前坐标和方向得到下一个点的坐标
	function nextPoint(idx,dir,cols, rows) {
		let y = idx/cols | 0;
		let x = idx % cols;
		let angle = dir+Math.PI/12;
		let step = Math.PI/6;
		let angleIndex = 0;
		for (let i=0;i<=12;i++) {
			if (angle>=i*step && angle<(i+1)*step) {
				angleIndex = i;
			}
		}
		let x2 = x,y2 = y-2;
		switch (angleIndex) {
			case 0: x2 = x; y2 = y-2;	break;
			case 1: x2 = x+1; y2 = y-2;	break;
			case 2: x2 = x+2; y2 = y-1;	break;
			case 3: x2 = x+2; y2 = y;	break;
			case 4: x2 = x+2; y2 = y+1;	break;
			case 5: x2 = x+1; y2 = y+2;	break;
			case 6: x2 = x; y2 = y+2;	break;
			case 7: x2 = x-1; y2 = y+2;	break;
			case 8: x2 = x-2; y2 = y+1;	break;
			case 9: x2 = x-2; y2 = y;	break;
			case 10: x2 = x-2; y2 = y-1;	break;
			case 11: x2 = x-1; y2 = y-2;	break;
			case 12: x2 = x; y2 = y-2;	break;
		}
		if (x2<0||x2>=cols||y2<0||y2>=rows) return -1;
		return y2*cols+x2;
	}
	
	// 寻找0时刻风向连续曲线
	function getTimeCurve(uv, t) {
		function normalizeWindSpeed(s){
			return (s-uv.VarDataRange[0])/(uv.VarDataRange[1]-uv.VarDataRange[0]);
		}
		
		if (uv.TimeCurve && uv.TimeCurve[t])
			return uv.TimeCurve[t];
		
		var previewCurves = [];
		var windCurves = [];
		var uvData = uv.VarData[t];
		var uvDir = uv.VarDataDir[t];
		var skipVal = uv.VarDataRange[0]+(uv.VarDataRange[1]-uv.VarDataRange[0])/64;
		let findFlag = {};
		let cols = uv.VarDataDim[1];
		let rows = uv.VarDataDim[0];
		for (let index=0,n=uvData.length;index<n;index++) {
			if (findFlag[index]) continue;
			findFlag[index] = 1;
			//if (uvData[index]<skipVal) continue;
			let points = [index];
			// 计算风向的下一个点
			let allIndex = [index];
			let nextIndex = index;
			while(1) {
				var wAngle = uvDir[nextIndex]
				nextIndex = nextPoint(nextIndex, wAngle, cols, rows);
				if (nextIndex<0 || nextIndex>=uvData.length || findFlag[nextIndex] || uvData[nextIndex]<skipVal)
					break;
				if (Math.abs(wAngle-uvDir[nextIndex])>=Math.PI) {
					wAngle = Math.PI*2 - Math.abs(wAngle-uvDir[nextIndex]);
				} else {
					wAngle = Math.abs(wAngle-uvDir[nextIndex]);
				}
				if (wAngle>=Math.PI/2-0.01) // 连续两点夹角不能大于九十度
					break;
				points.push(nextIndex);
				findFlag[nextIndex] = 1;
				allIndex.push(nextIndex);
			}
			// 回溯风的来源
			nextIndex = index;
			while(1) {
				var wAngle = uvDir[nextIndex];
				nextIndex = nextPoint(nextIndex, (wAngle+Math.PI) % (2*Math.PI), cols, rows);
				if (nextIndex<0 || nextIndex>=uvData.length || findFlag[nextIndex] || uvData[nextIndex]<skipVal)
					break;
				if (Math.abs(wAngle-uvDir[nextIndex])>=Math.PI) {
					wAngle = Math.PI*2 - Math.abs(wAngle-uvDir[nextIndex]);
				} else {
					wAngle = Math.abs(wAngle-uvDir[nextIndex]);
				}
				if (wAngle>=Math.PI/2-0.01) // 连续两点夹角不能大于九十度
					break;
				points.unshift(nextIndex);
				findFlag[nextIndex] = 1;
				allIndex.push(nextIndex);
			}
			if (points.length>=3) {
				// 避免曲线间隔过密
	//			for (let i=0;i<allIndex.length;i+=1) {
	//				nextIndex = allIndex[i];
	//				findFlag[nextIndex-1] = findFlag[nextIndex-2] = findFlag[nextIndex+1] = findFlag[nextIndex+2] = 1;
	//				findFlag[nextIndex-cols] = findFlag[nextIndex+cols] = 1;
	//			}
				let curvePoint = [];
				for (let i=0,n=points.length;i<n;i++) {
					let i0 = points[i];
					curvePoint.push([uv.LonData[i0]*1000,uv.LatData[i0]*1000, normalizeWindSpeed(uvData[i0])]);
				}
				
				// 插值，interLine[i][3]为两点间距离
				let interLine = smoothSpline(curvePoint);
				for (let i=0;i<interLine.length;i++) {
					interLine[i][0] /= 1000;
					interLine[i][1] /= 1000;
				}
				windCurves.push(interLine);
				
				for (let i=0,n=interLine.length-1;i<n;i++) {
					let i0 = interLine[i];
					let i1 = interLine[i+1];
					previewCurves.push(i0[0],i0[1],i0[2]);
					previewCurves.push(i1[0],i1[1],i1[2]);
				}
			}
		}
		if (!uv.TimeCurve)
			uv.TimeCurve = [];
		uv.TimeCurve[t] = windCurves;
		return windCurves;
	}
	
	// 根据风向曲线得到精灵线段初始坐标
	function initWindSprite(windCurves) {
		let sprites = [];
		for (let i in windCurves) {
			let curve = windCurves[i];
			// 曲线点太多就多画几个精灵
			for (let j=Math.random()*30|0,jn=curve.length;j<jn-1;j+=60) {
				// 下一个路径点为速度除以线段长度
				let nextPos = 5* curve[j][2] / curve[j+1][3];
				if (nextPos>1) nextPos = 1;
				sprites.push({
					index: j,
					pos: 0,
					nextPos: nextPos,
					curve: curve,
				});
			}
		}
		return sprites;
	}
	
	// 更新精灵线段位置
	function updateWindSprite(sprites) {
		for (let i in sprites) {
			let s = sprites[i];
			let curve = s.curve;
			if (s.nextPos>=1) {
				s.index = (s.index+1) % (curve.length-1);
				s.pos = 0;
				s.nextPos = 5 * curve[s.index][2] / curve[s.index+1][3];
			} else {
				s.pos = s.nextPos;
				s.nextPos += 5 * curve[s.index][2] / curve[s.index+1][3];
			}
			if (s.nextPos>1)
				s.nextPos = 1;
		}
	}

	function initCanvas() {
		// 预处理风向曲线
		//for (let i in uv.TimeData)
		//	getTimeCurve(uv, i);
		
		$("#layerLegend"+layer.id).html('<span>'+uv.VarDataRange[0].toFixed(3)+'</span><span style="position:absolute;left:250px">'+uv.VarDataRange[1].toFixed(3)+'</span>'
				+'<div style="margin-left:20px;height:10px;width:100px;background:linear-gradient(to left, rgb(125,0,0), rgb(255,0,0), rgb(220,255,25), rgb(25,50,255), rgb(0,0,125))">'+'</div>');
		
		previewCanvas = document.getElementById('layerPreviewCanvas');
		mainCanvas = document.getElementById('layerWindCanvas'); // 风向图层与主图层参数不同，不能绘制在一起

		if (previewCanvas) {
			if (viewerIndex==0) // 只有第一个二维视图负责绘制缩略图
				drawPreview = initPreviewCanvas(previewCanvas);
		}
		if (mainCanvas && map) {
			drawMain = initMainCanvas(mainCanvas);
		}
	}
	
	// 绘制预览区风力热图
	function initPreviewCanvas(windCanvasObject) {
		var rows = uv.VarDataDim[0];
		var stride = uv.VarDataDim[1];
		var index = 0;
		var indices = [];

		for (let j=0;j<rows-1;j++) {
			for (let i=0;i<stride-1;i++) {
				let base = j*stride + i;
				indices[index++] = base;
				indices[index++] = base + 1;
				indices[index++] = base + stride;
				indices[index++] = base + 1;
				indices[index++] = base + stride;
				indices[index++] = base + stride + 1;
			}
		}

		let webgl = windCanvasObject.getContext('webgl');
//    webgl.viewport(0, 0, windCanvasObject.clientWidth, windCanvasObject.clientHeight);
//    webgl.enable(webgl.BLEND);
//    webgl.disable(webgl.DEPTH_TEST);
//    webgl.blendFunc(webgl.SRC_ALPHA, webgl.ZERO);

    let vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    let fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, previewVertextShaderStr);
    webgl.shaderSource(fragmentShaderObject, previewFragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    let programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}
    webgl.useProgram(programObject);

    let attrPosLat = webgl.getAttribLocation(programObject, "posLat");
    let attrPosLon = webgl.getAttribLocation(programObject, "posLon");
    let attrDensity = webgl.getAttribLocation(programObject, "density");
    let attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrDataRange = webgl.getUniformLocation(programObject, "dataRange");
    let attrColorStep = [webgl.getUniformLocation(programObject, "startColor"),webgl.getUniformLocation(programObject, "midColor1"),
    webgl.getUniformLocation(programObject, "midColor2"),webgl.getUniformLocation(programObject, "midColor3"),webgl.getUniformLocation(programObject, "endColor")];
	  webgl.uniform3fv(attrColorStep[0], [0.3,0,0]);
	  webgl.uniform3fv(attrColorStep[1], [1,0,0]);
	  webgl.uniform3fv(attrColorStep[2], [0.9,1,0.1]);
	  webgl.uniform3fv(attrColorStep[3], [0.1,0.2,1]);
	  webgl.uniform3fv(attrColorStep[4], [0,0,0.5]);

	  webgl.uniform2fv(attrDataRange, uv.VarDataRange);	
	  webgl.uniform4f(attrLatlonRange, uv.LonCenter, (uv.LonRange[1]-uv.LonRange[0])/2, uv.LatCenter, (uv.LatRange[1]-uv.LatRange[0])/2);
    
    let latBuffer = webgl.createBuffer();
    let lonBuffer = webgl.createBuffer();
		let indexBuffer = webgl.createBuffer();
    let densityBuffer = webgl.createBuffer();

    webgl.bindBuffer(webgl.ARRAY_BUFFER, latBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(uv.LatData), webgl.STATIC_DRAW);
    webgl.bindBuffer(webgl.ARRAY_BUFFER, lonBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(uv.LonData), webgl.STATIC_DRAW);
	
		return function (currentDensityData) {
	    webgl.useProgram(programObject);
		  webgl.clearColor(0.0, 0.0, 0.0, 0.8);
		  webgl.clear(webgl.COLOR_BUFFER_BIT);
		  
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, latBuffer);
		  webgl.enableVertexAttribArray(attrPosLat); 
		  webgl.vertexAttribPointer(attrPosLat, 1, webgl.FLOAT, false, 0, 0);
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, lonBuffer);
		  webgl.enableVertexAttribArray(attrPosLon); 
		  webgl.vertexAttribPointer(attrPosLon, 1, webgl.FLOAT, false, 0, 0);
		
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, densityBuffer);
		  webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(currentDensityData), webgl.STATIC_DRAW);
		  webgl.enableVertexAttribArray(attrDensity); 
		  webgl.vertexAttribPointer(attrDensity, 1, webgl.FLOAT, false, 0, 0);
		  
			webgl.bindBuffer(webgl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			webgl.bufferData(webgl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), webgl.STATIC_DRAW);
			
		  webgl.drawElements(webgl.TRIANGLES, indices.length, webgl.UNSIGNED_SHORT, 0);
		}
	}


	function initMainCanvas(canvasObject) {
		let webgl = canvasObject.getContext("webgl", { alpha:true, depth: false, antialias: true, preserveDrawingBuffer:true,  });
    webgl.viewport(0, 0, canvasObject.clientWidth, canvasObject.clientHeight);

		webgl.blendFunc( webgl.SRC_ALPHA, webgl.ONE_MINUS_SRC_ALPHA);
    webgl.enable(webgl.BLEND);
    webgl.lineWidth(2.0);
		
    let vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    let fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    let programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    let attrScatterData = webgl.getAttribLocation(programObject, "scatterData");
    let attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    let attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    let attrColor = webgl.getUniformLocation(programObject, "uColor");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");

    webgl.useProgram(programObject);
    webgl.clearColor(0.0, 0.0, 0.0, 0.0);
    webgl.clear(webgl.COLOR_BUFFER_BIT);
    
    let scatterBuffer = webgl.createBuffer();
    
	  webgl.uniform1f(attrOpacity, 1);
    webgl.uniform4fv(attrColor, [0.1, 0.751,0.97, 1.0]);
	  
    webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
	  webgl.enableVertexAttribArray(attrScatterData); 
	  webgl.vertexAttribPointer(attrScatterData, 3, webgl.FLOAT, false, 0, 0);
		 	  
		// 绘制遮罩矩形，用于绘制风向线段精灵的拖影
		let drawMaskRect = getDrawMaskRectFunc(webgl);
	  
	  return 	function (spriteBuf) {
	  	if (!spriteBuf) {
				webgl.clear(webgl.COLOR_BUFFER_BIT);
				return;
	  	}
			// 绘制地图叠加层风向精灵
		 	drawMaskRect();
		  webgl.useProgram(programObject);
			
	    webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
	    webgl.bufferData(webgl.ARRAY_BUFFER, spriteBuf, webgl.DYNAMIC_DRAW);
		  webgl.enableVertexAttribArray(attrScatterData); 
		  webgl.vertexAttribPointer(attrScatterData, 3, webgl.FLOAT, false, 0, 0);

		  let temp = ol.proj.toLonLat(map.getView().getCenter());
		  let center = {lon:temp[0], lat:temp[1]};//map.center();
		  temp = map.getSize();
		  let size = {x:temp[0],y:temp[1]};//map.size();
		
		  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
		  let k = Math.pow(2, map.getView().getZoom() - 3) * 512.0 / 45.0;
		  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
		  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
		  webgl.uniform1f(attrOpacity, layer.opacity);
		
		  webgl.drawArrays(webgl.LINES, 0, sprites.length*2); //indexBufLen/4);		
		}
	}

	var sprites;
	var spriteBuf = null;
	var timeIndex = -1;
	layer.onTick = function(t) {
		let newIndex = 0;
		for (var i=0;i<uv.TimeData.length;i++)
			if (uv.TimeData[i]<=t)
				newIndex = i;
		if (newIndex!=timeIndex || !sprites) {
			timeIndex = newIndex;
			newIndex = -1;
			sprites = initWindSprite( getTimeCurve(uv, timeIndex) );
		}
		
		// 仅当数据改变时绘制预览画面
		if (newIndex<0) {
			if (drawPreview) {
				drawPreview(uv.VarData[timeIndex]);
	  		setLayerPreviewImg(layer.id, previewCanvas.toDataURL("image/png")); 
	  	}
		}
	}
	
	initCanvas();
	layer.onTick(0);

	layer.onDraw = function(mapMoving) {
		if (!map.isDragging() && !mapMoving) {
			if (layer.visible && sprites) {
		  	updateWindSprite(sprites);
				if (!spriteBuf || spriteBuf.length<sprites.length*6) {
					spriteBuf = new Float32Array(sprites.length*6);
				}
				
				// 更新精灵位置
				let index = 0;
				for (let i=0,n=sprites.length;i<n;i++){
					let s = sprites[i];
					let pt0 = s.curve[s.index];
					let pt1 = s.curve[s.index+1];
					let speed = s.curve[s.index][2];
					let dx = pt1[0]-pt0[0];
					let dy = pt1[1]-pt0[1];
					spriteBuf[index++] = pt0[0]+dx*s.pos;
					spriteBuf[index++] = pt0[1]+dy*s.pos;
					spriteBuf[index++] = speed;
					spriteBuf[index++] = pt0[0]+dx*s.nextPos;
					spriteBuf[index++] = pt0[1]+dy*s.nextPos;
					spriteBuf[index++] = speed;
				}
			}
		
			drawMain(spriteBuf);
		} else {
			drawMain();
		}
	}
	
	layer.onMouseMove = function(pos) {
		var data = uv.VarData[timeIndex];
		if (!data) return;
		if (pos.lon>uv.LonRange[0]&&pos.lon<=uv.LonRange[1] && pos.lat>uv.LatRange[0]&&pos.lat<=uv.LatRange[1]) {
			var i = Math.trunc(0.5+((pos.lon-uv.LonRange[0]) * uv.VarDataDim[0] / (uv.LonRange[1]-uv.LonRange[0])));
			var j = Math.trunc(0.5+((pos.lat-uv.LatRange[0]) * uv.VarDataDim[1] / (uv.LatRange[1]-uv.LatRange[0])));
			if (data[(j-1)*uv.VarDataDim[1] + i-1])
				setLayerPreviewInfo(layer.id, data[(j-1)*uv.VarDataDim[1] + i-1].toFixed(5)+' '+layer.unit);
		}
	}
}
